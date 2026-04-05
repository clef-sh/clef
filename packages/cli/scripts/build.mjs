// @ts-check
import { build } from "esbuild";
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { execFileSync } from "child_process";
import { resolve, dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const SEA_BUILD = process.argv.includes("--sea");

// ── Shared esbuild base config ────────────────────────────────────────────────

const BASE_CONFIG = {
  entryPoints: [resolve(packageRoot, "src/index.ts")],
  bundle: true,
  platform: /** @type {const} */ ("node"),
  target: "node18",
  // Ensure packages hoisted to the workspace root are always found.
  nodePaths: [resolve(repoRoot, "node_modules")],
  // fsevents is an optional native dep of chokidar and cannot be bundled.
  external: [
    "fsevents",
    "@aws-sdk/client-kms",
    "@azure/identity",
    "@azure/keyvault-keys",
    "@google-cloud/kms",
  ],
  // Alias @clef-sh/core to its TypeScript source files.
  //
  // @clef-sh/core's package.json "main" points to dist/index.js (CJS compiled
  // by tsc).  tsc transforms dynamic import("age-encryption") into:
  //   Promise.resolve(`${"age-encryption"}`).then(s => require(s))
  // The template-literal trick hides the string from esbuild's static analyzer,
  // so esbuild cannot bundle age-encryption inline and leaves a dangling runtime
  // require() that fails at install time.
  //
  // Aliasing to the TypeScript source lets esbuild see the raw
  // `import("age-encryption")` before tsc obscures it.  The ESM build then
  // bundles it natively; the CJS build intercepts it with the plugin below.
  alias: {
    "@clef-sh/core": resolve(repoRoot, "packages/core/src/index.ts"),
    "@clef-sh/cloud": resolve(repoRoot, "packages/cloud/src/index.ts"),
    "@clef-sh/cloud/cli": resolve(repoRoot, "packages/cloud/src/cli.ts"),
  },
};

// ── age-encryption CJS pre-bundle (used by the CJS build) ────────────────────
//
// Node SEA requires a CommonJS main script, and some consumers still use
// require().  With @clef-sh/core aliased to TypeScript source, esbuild CAN
// now see import("age-encryption") statically and calls onResolve — but in CJS
// output mode dynamic imports are still emitted as runtime require() rather than
// being inlined.  We pre-bundle age-encryption to CJS and inject it as a virtual
// module so the runtime require() resolves from the bundle registry.

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

// ── ESM bundle — dist/index.mjs (primary, shipped to npm) ────────────────────

console.log("Bundling ESM...");
await build({
  ...BASE_CONFIG,
  format: "esm",
  outfile: resolve(packageRoot, "dist/index.mjs"),
  sourcemap: true,
  // Polyfill CJS globals for ESM context:
  //  • require  — CJS packages bundled into ESM call require() internally; esbuild's
  //               __require shim throws when require is undefined in native ESM.
  //  • __filename / __dirname — used by our own source (e.g. ui.ts) and by some
  //               bundled CJS modules that call path.resolve(__dirname, ...).
  banner: {
    js: [
      `import { createRequire } from "node:module";`,
      `import { fileURLToPath } from "node:url";`,
      `const require = createRequire(import.meta.url);`,
      `const __filename = fileURLToPath(import.meta.url);`,
      `const __dirname = fileURLToPath(new URL(".", import.meta.url));`,
    ].join("\n"),
  },
});

// ── CJS bundle — dist/index.cjs (require() compat + SEA input) ───────────────

console.log("Bundling CJS...");
await build({
  ...BASE_CONFIG,
  format: "cjs",
  outfile: resolve(packageRoot, "dist/index.cjs"),
  sourcemap: true,
  plugins: [ageEncryptionPlugin],
});

// Copy UI client static files alongside the bundle so Express can serve them.
// In the bundle __dirname resolves to dist/, so assets land in dist/client/.
const uiClientSrc = resolve(repoRoot, "packages/ui/dist/client");
const uiClientDest = resolve(packageRoot, "dist/client");
if (existsSync(uiClientSrc)) {
  mkdirSync(uiClientDest, { recursive: true });
  cpSync(uiClientSrc, uiClientDest, { recursive: true });
  console.log("Copied UI client files.");
} else {
  console.warn("Warning: packages/ui/dist/client not found — UI command will not serve assets.");
}

console.log("Build complete.");

// ── SEA binary ────────────────────────────────────────────────────────────────
// dist/index.cjs already exists from the main build — no extra CJS step needed.

if (SEA_BUILD) {
  await buildSea();
}

async function buildSea() {
  console.log("\nBuilding SEA binary...");

  const assets = /** @type {Record<string, string>} */ ({});

  /**
   * @param {import("node:fs").PathLike} dir
   * @param {string} keyPrefix
   */
  function collectAssets(dir, keyPrefix) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir.toString(), entry.name);
      const key = `${keyPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        collectAssets(fullPath, key);
      } else {
        if (statSync(fullPath).size > 0) {
          assets[key] = relative(packageRoot, fullPath);
        }
      }
    }
  }

  if (existsSync(uiClientDest)) {
    collectAssets(uiClientDest, "client");
  }

  const seaConfig = {
    main: "dist/index.cjs",
    output: "dist/sea-prep.blob",
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    assets,
  };
  writeFileSync(resolve(packageRoot, "sea-config.json"), JSON.stringify(seaConfig, null, 2));
  console.log(`Wrote sea-config.json with ${Object.keys(assets).length} assets.`);

  execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], {
    cwd: packageRoot,
    stdio: "inherit",
  });

  const binaryName = process.platform === "win32" ? "clef.exe" : "clef";
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
