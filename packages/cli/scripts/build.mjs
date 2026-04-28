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
  // All @clef-sh/* workspace packages are externalized for the npm builds so
  // the published CLI resolves them through node_modules at runtime. This:
  //   • makes the dependency graph honest (npm ls reflects what actually
  //     loads — no inlined duplicates),
  //   • lets users uninstall the optional plugins (cloud, ui, analytics)
  //     and have the existing try/catch stubs take over,
  //   • lets patch releases of workspace packages flow without a CLI
  //     republish.
  // SEA can't resolve node_modules at runtime, so the SEA-only build
  // re-aliases every @clef-sh/* entry below (SEA_BUNDLED_ALIAS) and
  // strips them from external for that one esbuild call.
  external: [
    "fsevents",
    "@aws-sdk/client-kms",
    "@azure/identity",
    "@azure/keyvault-keys",
    "@google-cloud/kms",
    "@clef-sh/agent",
    "@clef-sh/analytics",
    "@clef-sh/cloud",
    "@clef-sh/cloud/cli",
    "@clef-sh/core",
    "@clef-sh/pack-aws-parameter-store",
    "@clef-sh/pack-aws-secrets-manager",
    "@clef-sh/runtime",
    "@clef-sh/ui",
  ],
};

/**
 * Workspace package aliases — applied ONLY to the SEA-input bundle.
 *
 * The npm builds leave every @clef-sh/* import as a runtime resolution
 * (see BASE_CONFIG.external above). For SEA we point each one at its
 * TypeScript source so esbuild can follow the imports and inline the
 * code into a single self-contained binary.
 *
 * @clef-sh/core is the reason the ageEncryptionPlugin still exists:
 * core's compiled dist/index.js obfuscates `import("age-encryption")`
 * via a template-literal to hide it from bundlers. Aliasing core to
 * source lets esbuild see the raw dynamic import before tsc rewrites
 * it; the plugin then injects the pre-bundled CJS for the SEA build.
 */
const SEA_BUNDLED_ALIAS = {
  "@clef-sh/agent": resolve(repoRoot, "packages/agent/src/index.ts"),
  "@clef-sh/analytics": resolve(repoRoot, "packages/analytics/src/index.ts"),
  "@clef-sh/cloud": resolve(repoRoot, "packages/cloud/src/index.ts"),
  "@clef-sh/cloud/cli": resolve(repoRoot, "packages/cloud/src/cli.ts"),
  "@clef-sh/core": resolve(repoRoot, "packages/core/src/index.ts"),
  "@clef-sh/pack-aws-parameter-store": resolve(
    repoRoot,
    "packages/pack/aws-parameter-store/src/index.ts",
  ),
  "@clef-sh/pack-aws-secrets-manager": resolve(
    repoRoot,
    "packages/pack/aws-secrets-manager/src/index.ts",
  ),
  "@clef-sh/runtime": resolve(repoRoot, "packages/runtime/src/index.ts"),
  "@clef-sh/ui": resolve(repoRoot, "packages/ui/src/server/index.ts"),
};

// ── Clean dist ────────────────────────────────────────────────────────────────

rmSync(resolve(packageRoot, "dist"), { recursive: true, force: true });

// ── age-encryption CJS pre-bundle (used by the SEA build only) ───────────────
//
// Node SEA requires a CommonJS main script. The SEA bundle aliases
// @clef-sh/core to its TypeScript source so esbuild can follow the
// imports — including a dynamic `import("age-encryption")` that core's
// compiled dist would otherwise hide via a template-literal trick. In
// CJS output mode esbuild still emits dynamic imports as runtime
// require() rather than inlining them, so we pre-bundle age-encryption
// to CJS and inject it as a virtual module that the runtime require()
// resolves from the bundle registry.
//
// The npm builds external @clef-sh/core entirely, so this plugin never
// runs in the npm path — Node resolves age-encryption at runtime
// against node_modules through core's normal dist/index.js.

/** @type {import('esbuild').Plugin | null} */
let ageEncryptionPlugin = null;
if (SEA_BUILD) {
  console.log("Pre-bundling age-encryption (ESM→CJS) for SEA...");
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
  ageEncryptionPlugin = {
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
}

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

// ── CJS bundle — dist/index.cjs (require() compat for npm consumers) ─────────

console.log("Bundling CJS...");
await build({
  ...BASE_CONFIG,
  format: "cjs",
  outfile: resolve(packageRoot, "dist/index.cjs"),
  sourcemap: true,
});

console.log("Build complete.");

// ── SEA binary ────────────────────────────────────────────────────────────────
// SEA needs its own CJS bundle with every @clef-sh/* workspace package
// aliased+bundled, because a single-file binary can't resolve node_modules
// at runtime. The npm-shipped dist/index.cjs leaves them all external so
// users can uninstall optional plugins; that bundle is unsuitable as SEA
// input.

if (SEA_BUILD) {
  console.log("Bundling SEA CJS (all @clef-sh/* inlined)...");
  const seaBundledNames = new Set(Object.keys(SEA_BUNDLED_ALIAS));
  await build({
    ...BASE_CONFIG,
    // Strip the @clef-sh/* externals so esbuild follows the imports
    // through to the aliased source instead of leaving them as runtime
    // requires.
    external: BASE_CONFIG.external.filter((p) => !seaBundledNames.has(p)),
    alias: SEA_BUNDLED_ALIAS,
    format: "cjs",
    outfile: resolve(packageRoot, "dist/index.sea.cjs"),
    sourcemap: true,
    plugins: ageEncryptionPlugin ? [ageEncryptionPlugin] : [],
  });
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

  // Copy UI client files for SEA binary asset embedding.
  const uiClientSrc = resolve(repoRoot, "packages/ui/dist/client");
  const uiClientDest = resolve(packageRoot, "dist/client");
  if (existsSync(uiClientSrc)) {
    mkdirSync(uiClientDest, { recursive: true });
    cpSync(uiClientSrc, uiClientDest, { recursive: true });
    collectAssets(uiClientDest, "client");
  }

  // Embed scaffold templates (policy.yaml + CI workflows) for `clef policy init`.
  // Keys are prefixed "templates/..." so the runtime loader can request them
  // with the same relative paths it uses when reading from disk.
  const templatesSrc = resolve(packageRoot, "templates");
  if (existsSync(templatesSrc)) {
    collectAssets(templatesSrc, "templates");
  }

  const seaConfig = {
    main: "dist/index.sea.cjs",
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
