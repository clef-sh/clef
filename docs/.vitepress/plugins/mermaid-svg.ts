// Build-time mermaid → SVG plugin.
//
// Why: vitepress-plugin-mermaid renders client-side, which (a) ships ~100 KB
// of mermaid + dompurify + uuid to every visitor (security alerts come along
// for the ride), (b) declares vp1 as a peer and so blocks vp2 from hoisting
// in our workspace tree (forcing the registry build symlink hack). Rendering
// to static SVGs at build time eliminates both.
//
// What this does:
//   - Hooks markdown-it's fence handler for ```mermaid blocks
//   - Computes a SHA-256 of the block content; cache key splits dark/light
//   - Renders <hash>.dark.svg + <hash>.light.svg via mmdc on first miss
//   - Inlines both SVGs into the rendered HTML inside paired wrappers; CSS in
//     theme/style.css hides the wrong one based on vitepress's `html.dark`
//     class
//
// Why inline (not <img src=>): Vue's template compiler auto-rewrites <img src>
// into vite asset imports (?import suffix). Files in docs/public/ are not in
// vite's module graph, so those imports fall through to the SPA-shell HTML
// and the browser shows broken images. Inlining the SVG sidesteps the
// rewrite entirely — no URL roundtrip, no compile-time transform to dodge.
//
// SVGs land in docs/public/diagrams/, gitignored — CI regenerates fresh,
// locals regenerate on first build after a diagram change.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type MarkdownIt from "markdown-it";
import type { Renderer } from "markdown-it";

// vitepress passes a MarkdownItAsync, but we only touch renderer.rules.fence
// which is shared with the sync MarkdownIt type — accept either by widening
// to the renderer-only surface we need.
type MarkdownItLike = Pick<MarkdownIt, "renderer"> & {
  renderer: { rules: Renderer["rules"] };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "..", "..");
const DIAGRAMS_DIR = path.join(DOCS_ROOT, "public", "diagrams");
const PUBLIC_PREFIX = "/diagrams";

// Resolve mmdc from whichever node_modules npm hoisted it into. Walks up
// from docs/ so it picks up either docs/node_modules/.bin/mmdc (per-workspace)
// or node_modules/.bin/mmdc (hoisted to root).
function resolveMmdcBin(): string {
  let dir = DOCS_ROOT;
  while (true) {
    const candidate = path.join(dir, "node_modules", ".bin", "mmdc");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "mermaid-svg plugin: could not find `mmdc` binary. Is `@mermaid-js/mermaid-cli` installed?",
  );
}

let mmdcBinCache: string | null = null;
function mmdcBin(): string {
  if (!mmdcBinCache) mmdcBinCache = resolveMmdcBin();
  return mmdcBinCache;
}

type Theme = "dark" | "light";

const THEME_CONFIG: Record<Theme, { theme: string; backgroundColor: string }> = {
  dark: { theme: "dark", backgroundColor: "transparent" },
  light: { theme: "default", backgroundColor: "transparent" },
};

function ensureDiagramsDir(): void {
  if (!existsSync(DIAGRAMS_DIR)) {
    mkdirSync(DIAGRAMS_DIR, { recursive: true });
  }
}

function svgPathFor(hash: string, theme: Theme): string {
  return path.join(DIAGRAMS_DIR, `${hash}.${theme}.svg`);
}

function renderOne(source: string, hash: string, theme: Theme): void {
  const outPath = svgPathFor(hash, theme);
  if (existsSync(outPath)) return;

  ensureDiagramsDir();

  const cfg = THEME_CONFIG[theme];
  const tmp = mkdtempSync(path.join(tmpdir(), "mermaid-svg-"));
  const inputPath = path.join(tmp, "input.mmd");
  const configPath = path.join(tmp, "config.json");

  try {
    writeFileSync(inputPath, source, "utf8");
    writeFileSync(
      configPath,
      JSON.stringify({
        theme: cfg.theme,
        themeVariables: { fontFamily: "inherit" },
      }),
      "utf8",
    );

    execFileSync(
      mmdcBin(),
      [
        "-i",
        inputPath,
        "-o",
        outPath,
        "-b",
        cfg.backgroundColor,
        "-c",
        configPath,
        "--quiet",
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function renderBoth(source: string): { hash: string } {
  // Hash the source only — themes are independent variants of the same content,
  // so a change to one block invalidates both SVGs together.
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  renderOne(source, hash, "dark");
  renderOne(source, hash, "light");
  return { hash };
}

export function mermaidSvgPlugin(md: MarkdownItLike): void {
  const fence = md.renderer.rules.fence;
  if (!fence) {
    throw new Error("markdown-it: no default fence renderer to wrap");
  }

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() !== "mermaid") {
      return fence(tokens, idx, options, env, self);
    }

    const { hash } = renderBoth(token.content);
    const darkSvg = readFileSync(svgPathFor(hash, "dark"), "utf8");
    const lightSvg = readFileSync(svgPathFor(hash, "light"), "utf8");

    // Wrap each SVG in a div with the theme class so style.css can hide the
    // wrong one. Keep the SVG markup intact (mmdc emits a self-contained
    // `<svg>` element with embedded styles).
    return (
      `<div class="mermaid-diagram">` +
      `<div class="mermaid-diagram-light">${lightSvg}</div>` +
      `<div class="mermaid-diagram-dark">${darkSvg}</div>` +
      `</div>`
    );
  };
}
