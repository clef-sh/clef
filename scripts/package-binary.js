#!/usr/bin/env node
// scripts/package-binary.js
// Usage: node scripts/package-binary.js <output-name>
// Packages packages/cli/dist/index.js as a standalone binary

const { execSync } = require("child_process");
const { writeFileSync, copyFileSync, mkdirSync } = require("fs");
const path = require("path");

const outputName = process.argv[2];
if (!outputName) {
  console.error("Usage: node scripts/package-binary.js <output-name>");
  process.exit(1);
}

const outDir = path.join(__dirname, "..", "dist", outputName);
mkdirSync(outDir, { recursive: true });

// Generate SEA config
const seaConfigPath = path.join(outDir, "sea-config.json");
const seaConfig = {
  main: path.join(__dirname, "..", "packages", "cli", "dist", "index.js"),
  output: path.join(outDir, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
};

writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));
execSync(`node --experimental-sea-config "${seaConfigPath}"`);

// Copy node binary and inject blob
const nodeBinary = process.execPath;
const outputBinary = path.join(outDir, outputName);
const blobPath = path.join(outDir, "sea-prep.blob");
copyFileSync(nodeBinary, outputBinary);

// Remove signature (macOS), inject blob, re-sign
if (process.platform === "darwin") {
  execSync(`codesign --remove-signature "${outputBinary}"`);
}
execSync(
  `npx postject "${outputBinary}" NODE_SEA_BLOB "${blobPath}" ` +
    `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` +
    (process.platform === "darwin" ? " --macho-segment-name NODE_SEA" : ""),
);
if (process.platform === "darwin") {
  execSync(`codesign --sign - "${outputBinary}"`);
}

console.log(`Binary packaged: ${outputBinary}`);
