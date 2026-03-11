#!/usr/bin/env node
// scripts/update-formula.js
// Updates version, URLs, and SHA256 values in clef-secrets.rb
// Usage: node scripts/update-formula.js <formula-path> <version>
//        <darwin-arm64-sha> <darwin-amd64-sha>
//        <linux-arm64-sha> <linux-amd64-sha>

const { readFileSync, writeFileSync } = require("fs");

const [, , formulaPath, version, darwinArm64Sha, darwinAmd64Sha, linuxArm64Sha, linuxAmd64Sha] =
  process.argv;

if (
  !formulaPath ||
  !version ||
  !darwinArm64Sha ||
  !darwinAmd64Sha ||
  !linuxArm64Sha ||
  !linuxAmd64Sha
) {
  console.error("Usage: node scripts/update-formula.js <formula-path> <version>");
  console.error("       <darwin-arm64-sha> <darwin-amd64-sha>");
  console.error("       <linux-arm64-sha> <linux-amd64-sha>");
  process.exit(1);
}

const BASE = `https://github.com/clef-sh/clef/releases/download/v${version}`;

// Map each platform slug to its new URL and SHA
const platforms = {
  "darwin-arm64": { sha: darwinArm64Sha },
  "darwin-amd64": { sha: darwinAmd64Sha },
  "linux-arm64": { sha: linuxArm64Sha },
  "linux-amd64": { sha: linuxAmd64Sha },
};

const lines = readFileSync(formulaPath, "utf8").split("\n");
const output = [];

// Track which platform block we're inside based on the most recent url line
let currentPlatform = null;

for (const line of lines) {
  let updated = line;

  // Update version
  if (/^\s*version\s+"/.test(line)) {
    updated = line.replace(/version "[^"]*"/, `version "${version}"`);
  }

  // Update url lines — detect which platform this is from the slug in the URL
  for (const slug of Object.keys(platforms)) {
    if (line.includes(`clef-`) && line.includes(slug) && /^\s*url\s+"/.test(line)) {
      currentPlatform = slug;
      updated = line.replace(/url "[^"]*"/, `url "${BASE}/clef-v${version}-${slug}.tar.gz"`);
      break;
    }
  }

  // Update sha256 lines — apply the SHA for the most recently seen platform
  if (/^\s*sha256\s+"/.test(line) && currentPlatform) {
    updated = line.replace(/sha256 "[^"]*"/, `sha256 "${platforms[currentPlatform].sha}"`);
    currentPlatform = null;
  }

  output.push(updated);
}

writeFileSync(formulaPath, output.join("\n"));
console.log(`Formula updated to v${version}`);
