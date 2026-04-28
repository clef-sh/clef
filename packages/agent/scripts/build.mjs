// @ts-check
import { build } from "esbuild";
import { copyFileSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const SEA_BUILD = process.argv.includes("--sea");

// ── Shared esbuild base config ────────────────────────────────────────────────

/** @type {import('esbuild').BuildOptions} */
const BASE_CONFIG = {
  bundle: true,
  platform: /** @type {const} */ ("node"),
  target: "node18",
  nodePaths: [resolve(repoRoot, "node_modules")],
  external: ["fsevents"],
  // Alias workspace packages to TypeScript source so esbuild can see the
  // raw `import("age-encryption")` before tsc obscures it with a
  // template-literal trick that hides the string from static analysis,
  // and so we never re-bundle a published ESM dist into this CJS output
  // (the published .mjs files carry a createRequire/import.meta.url
  // banner that esbuild emits as `undefined` in CJS context — see
  // packages/core/scripts/build.mjs). Reading from source bypasses both
  // landmines. Same pattern as the CLI's SEA build (SEA_BUNDLED_ALIAS).
  alias: {
    "@clef-sh/runtime": resolve(repoRoot, "packages/runtime/src/index.ts"),
    "@clef-sh/core": resolve(repoRoot, "packages/core/src/index.ts"),
  },
};

// ── age-encryption CJS pre-bundle ─────────────────────────────────────────────
//
// age-encryption is ESM-only.  The agent's CJS bundle (used as SEA input) needs
// a CJS-compatible version.  Pre-bundle it and inject via an esbuild plugin.

console.log("Pre-bundling age-encryption (ESM→CJS)...");
const ageResult = await build({
  stdin: {
    contents: 'export * from "age-encryption"',
    loader: "js",
    resolveDir: packageRoot,
  },
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  write: false,
  nodePaths: [resolve(repoRoot, "node_modules")],
});

const ageCjsContent = ageResult.outputFiles[0].text;

/** @type {import('esbuild').Plugin} */
const ageEncryptionPlugin = {
  name: "age-encryption-cjs",
  setup(build) {
    build.onResolve({ filter: /^age-encryption$/ }, () => ({
      path: "age-encryption",
      namespace: "age-encryption-cjs",
    }));
    build.onLoad({ filter: /.*/, namespace: "age-encryption-cjs" }, () => ({
      contents: ageCjsContent,
      loader: "js",
    }));
  },
};

// ── Clean dist ────────────────────────────────────────────────────────────────

rmSync(resolve(packageRoot, "dist"), { recursive: true, force: true });

// ── Library build — tsc (declarations + CJS for npm consumers) ────────────────

console.log("Building library (tsc)...");
const tscBin = resolve(
  repoRoot,
  process.platform === "win32" ? "node_modules/.bin/tsc.cmd" : "node_modules/.bin/tsc",
);
execFileSync(tscBin, ["--project", resolve(packageRoot, "tsconfig.build.json")], {
  cwd: packageRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

// ── CJS single-file bundle — dist/agent.cjs (SEA input) ──────────────────────

console.log("Bundling CJS single-file (main entry)...");
await build({
  ...BASE_CONFIG,
  entryPoints: [resolve(packageRoot, "src/main.ts")],
  format: "cjs",
  outfile: resolve(packageRoot, "dist/agent.cjs"),
  sourcemap: true,
  plugins: [ageEncryptionPlugin],
});

console.log("Build complete.");

// ── SEA binary ────────────────────────────────────────────────────────────────

if (SEA_BUILD) {
  await buildSea();
}

async function buildSea() {
  console.log("\nBuilding SEA binary...");

  const seaConfig = {
    main: "dist/agent.cjs",
    output: "dist/sea-prep.blob",
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
  };
  writeFileSync(resolve(packageRoot, "sea-config.json"), JSON.stringify(seaConfig, null, 2));

  execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], {
    cwd: packageRoot,
    stdio: "inherit",
  });

  const binaryName = process.platform === "win32" ? "clef-agent.exe" : "clef-agent";
  const outBinary = resolve(packageRoot, "dist", binaryName);

  copyFileSync(process.execPath, outBinary);

  if (process.platform === "darwin") {
    try {
      execFileSync("codesign", ["--remove-signature", outBinary], { stdio: "pipe" });
    } catch {
      // Unsigned binaries are fine — continue
    }
  }

  const postjectBin = resolve(
    repoRoot,
    process.platform === "win32" ? "node_modules/.bin/postject.cmd" : "node_modules/.bin/postject",
  );
  const postjectArgs = [
    outBinary,
    "NODE_SEA_BLOB",
    resolve(packageRoot, "dist/sea-prep.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];
  if (process.platform === "darwin") {
    postjectArgs.push("--macho-segment-name", "NODE_SEA");
  }
  execFileSync(postjectBin, postjectArgs, {
    cwd: packageRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (process.platform === "darwin") {
    try {
      execFileSync("codesign", ["--sign", "-", outBinary], { stdio: "pipe" });
    } catch {
      console.warn("codesign failed — binary may need manual signing on macOS.");
    }
  }

  if (process.platform !== "win32") {
    execFileSync("chmod", ["+x", outBinary]);
  }

  console.log(`\nSEA binary ready: dist/${binaryName}`);
}
