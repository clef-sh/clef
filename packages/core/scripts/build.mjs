// @ts-check
import { build } from "esbuild";
import { execFileSync } from "child_process";
import { rmSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");

// ── age-encryption CJS pre-bundle ──────────────────────────────────────────
//
// age-encryption is ESM-only.  The CJS build emits dynamic import() calls
// which break in jest and older Node runtimes that don't support top-level
// import() in CJS.  Pre-bundle age-encryption from ESM→CJS and inject it as
// a virtual module so the CJS output uses require() instead.

console.log("Pre-bundling age-encryption (ESM→CJS)...");
const ageResult = await build({
  stdin: {
    contents: 'export * from "age-encryption"',
    loader: "js",
    resolveDir: packageRoot,
  },
  bundle: true,
  platform: "node",
  target: "es2022",
  format: "cjs",
  write: false,
  nodePaths: [resolve(repoRoot, "node_modules")],
});

const ageCjsContent = ageResult.outputFiles[0].text;

/** @type {import('esbuild').Plugin} */
const ageEncryptionCjsPlugin = {
  name: "age-encryption-cjs",
  setup(b) {
    b.onResolve({ filter: /^age-encryption$/ }, () => ({
      path: "age-encryption",
      namespace: "age-encryption-cjs",
    }));
    b.onLoad({ filter: /.*/, namespace: "age-encryption-cjs" }, () => ({
      contents: ageCjsContent,
      loader: "js",
    }));
  },
};

// ── Shared config ──────────────────────────────────────────────────────────

const SHARED = {
  entryPoints: [resolve(packageRoot, "src/index.ts")],
  bundle: true,
  platform: /** @type {const} */ ("node"),
  target: "es2022",
  // Keep dependencies external — this is a library, not a CLI binary.
  external: ["yaml", "age-encryption"],
  sourcemap: true,
};

// ── Clean dist ─────────────────────────────────────────────────────────────

rmSync(resolve(packageRoot, "dist"), { recursive: true, force: true });

// ── ESM build — dist/index.mjs ─────────────────────────────────────────────

console.log("Bundling ESM...");
await build({
  ...SHARED,
  format: "esm",
  outfile: resolve(packageRoot, "dist/index.mjs"),
});

// ── CJS build — dist/index.js ──────────────────────────────────────────────
//
// age-encryption is NOT external for CJS — the plugin injects the pre-bundled
// CJS version so dynamic import() is replaced with require().

console.log("Bundling CJS...");
await build({
  ...SHARED,
  format: "cjs",
  outfile: resolve(packageRoot, "dist/index.js"),
  external: ["yaml"], // age-encryption handled by plugin
  plugins: [ageEncryptionCjsPlugin],
});

// ── Type declarations ──────────────────────────────────────────────────────
//
// tsc emits .d.ts files preserving the source directory structure.  This is
// needed because index.d.ts re-exports from submodules (./types, ./sops/client,
// etc.), so the full tree must be present under dist/.

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

// ESM consumers get the same entry declaration with .d.mts extension
copyFileSync(resolve(packageRoot, "dist/index.d.ts"), resolve(packageRoot, "dist/index.d.mts"));

console.log("Build complete.");
