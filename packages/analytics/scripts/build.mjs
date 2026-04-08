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
  entryPoints: [resolve(packageRoot, "src/index.ts")],
  bundle: true,
  platform: /** @type {const} */ ("node"),
  target: "es2022",
  external: ["posthog-node"],
  sourcemap: true,
};

rmSync(resolve(packageRoot, "dist"), { recursive: true, force: true });

console.log("Bundling ESM...");
await build({
  ...SHARED,
  format: "esm",
  outfile: resolve(packageRoot, "dist/index.mjs"),
});

console.log("Bundling CJS...");
await build({
  ...SHARED,
  format: "cjs",
  outfile: resolve(packageRoot, "dist/index.js"),
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

console.log("Build complete.");
