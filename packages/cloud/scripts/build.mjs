// @ts-check
import { build } from "esbuild";
import { execFileSync } from "child_process";
import { rmSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");

// ── Shared config ──────────────────────────────────────────────────────────

const SHARED = {
  bundle: true,
  platform: /** @type {const} */ ("node"),
  target: "es2022",
  external: ["@clef-sh/core", "commander", "yaml"],
  sourcemap: true,
};

// ── Clean dist ─────────────────────────────────────────────────────────────

rmSync(resolve(packageRoot, "dist"), { recursive: true, force: true });

// ── Build each entry point ─────────────────────────────────────────────────

const entries = [
  { entry: "src/index.ts", out: "index" },
  { entry: "src/cli.ts", out: "cli" },
];

// Polyfill CJS globals for the ESM output so bundled CJS deps that
// use require()/__dirname don't crash when this bundle is loaded by a
// pure-ESM consumer. esbuild's __require shim throws when require is
// undefined.
const ESM_BANNER = {
  js: [
    `import { createRequire } from "node:module";`,
    `import { fileURLToPath } from "node:url";`,
    `const require = createRequire(import.meta.url);`,
    `const __filename = fileURLToPath(import.meta.url);`,
    `const __dirname = fileURLToPath(new URL(".", import.meta.url));`,
  ].join("\n"),
};

for (const { entry, out } of entries) {
  console.log(`Bundling ${out} (ESM)...`);
  await build({
    ...SHARED,
    entryPoints: [resolve(packageRoot, entry)],
    format: "esm",
    outfile: resolve(packageRoot, `dist/${out}.mjs`),
    banner: ESM_BANNER,
  });

  console.log(`Bundling ${out} (CJS)...`);
  await build({
    ...SHARED,
    entryPoints: [resolve(packageRoot, entry)],
    format: "cjs",
    outfile: resolve(packageRoot, `dist/${out}.js`),
  });
}

// ── Type declarations ──────────────────────────────────────────────────────

console.log("Generating declarations...");
const tscBin = resolve(
  repoRoot,
  process.platform === "win32" ? "node_modules/.bin/tsc.cmd" : "node_modules/.bin/tsc",
);
execFileSync(
  tscBin,
  [
    "--project",
    resolve(packageRoot, "tsconfig.build.json"),
    "--emitDeclarationOnly",
    "--outDir",
    resolve(packageRoot, "dist"),
  ],
  { cwd: packageRoot, stdio: "inherit", shell: process.platform === "win32" },
);

// ESM consumers get the same entry declarations with .d.mts extension
for (const { out } of entries) {
  copyFileSync(resolve(packageRoot, `dist/${out}.d.ts`), resolve(packageRoot, `dist/${out}.d.mts`));
}

console.log("Build complete.");
