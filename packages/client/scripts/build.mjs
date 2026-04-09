// @ts-check
import { build } from "esbuild";
import { execFileSync } from "child_process";
import { rmSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");

const SHARED = {
  bundle: true,
  target: "es2022",
  sourcemap: true,
};

rmSync(resolve(packageRoot, "dist"), { recursive: true, force: true });

// Main entry — browser-safe (platform: neutral)
console.log("Bundling main entry (ESM)...");
await build({
  ...SHARED,
  entryPoints: [resolve(packageRoot, "src/index.ts")],
  format: "esm",
  platform: /** @type {const} */ ("neutral"),
  outfile: resolve(packageRoot, "dist/index.mjs"),
});

console.log("Bundling main entry (CJS)...");
await build({
  ...SHARED,
  entryPoints: [resolve(packageRoot, "src/index.ts")],
  format: "cjs",
  platform: /** @type {const} */ ("neutral"),
  outfile: resolve(packageRoot, "dist/index.js"),
});

// KMS entry — Node-only (uses Buffer)
console.log("Bundling KMS entry (ESM)...");
await build({
  ...SHARED,
  entryPoints: [resolve(packageRoot, "src/kms.ts")],
  format: "esm",
  platform: /** @type {const} */ ("node"),
  outfile: resolve(packageRoot, "dist/kms.mjs"),
});

console.log("Bundling KMS entry (CJS)...");
await build({
  ...SHARED,
  entryPoints: [resolve(packageRoot, "src/kms.ts")],
  format: "cjs",
  platform: /** @type {const} */ ("node"),
  outfile: resolve(packageRoot, "dist/kms.js"),
});

console.log("Generating declarations...");
const tscBin = resolve(
  repoRoot,
  process.platform === "win32" ? "node_modules/.bin/tsc.cmd" : "node_modules/.bin/tsc",
);
execFileSync(
  tscBin,
  [
    "--project",
    resolve(packageRoot, "tsconfig.json"),
    "--emitDeclarationOnly",
    "--outDir",
    resolve(packageRoot, "dist"),
  ],
  { cwd: packageRoot, stdio: "inherit", shell: process.platform === "win32" },
);

copyFileSync(resolve(packageRoot, "dist/index.d.ts"), resolve(packageRoot, "dist/index.d.mts"));
copyFileSync(resolve(packageRoot, "dist/kms.d.ts"), resolve(packageRoot, "dist/kms.d.mts"));

console.log("Build complete.");
