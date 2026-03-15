#!/usr/bin/env node

/**
 * Downloads the sops binary for each platform defined in sops-version.json,
 * verifies SHA256 checksums, and places them into the platform package directories.
 *
 * Usage:
 *   node scripts/download-sops.mjs                    # download all platforms
 *   node scripts/download-sops.mjs --platform darwin-arm64  # download one platform
 */

import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, chmodSync } from "node:fs";
import { readFile } from "node:fs/promises";
// import { pipeline } from "node:stream/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PLATFORM_MAP = {
  "darwin-arm64": { ghAsset: "sops-v{version}.darwin.arm64", binName: "sops" },
  "darwin-x64": { ghAsset: "sops-v{version}.darwin.amd64", binName: "sops" },
  "linux-x64": { ghAsset: "sops-v{version}.linux.amd64", binName: "sops" },
  "linux-arm64": { ghAsset: "sops-v{version}.linux.arm64", binName: "sops" },
  "win32-x64": { ghAsset: "sops-v{version}.exe", binName: "sops.exe" },
};

async function main() {
  const versionFile = await readFile(join(ROOT, "sops-version.json"), "utf-8");
  const { version, checksums } = JSON.parse(versionFile);

  const platformArg =
    process.argv.find((a) => a.startsWith("--platform="))?.split("=")[1] ??
    (process.argv.indexOf("--platform") !== -1
      ? process.argv[process.argv.indexOf("--platform") + 1]
      : null);

  const platforms = platformArg ? [platformArg] : Object.keys(PLATFORM_MAP);

  for (const platform of platforms) {
    const config = PLATFORM_MAP[platform];
    if (!config) {
      console.error(`Unknown platform: ${platform}`);
      console.error(`Valid platforms: ${Object.keys(PLATFORM_MAP).join(", ")}`);
      process.exit(1);
    }

    const assetName = config.ghAsset.replace("{version}", version);
    const url = `https://github.com/getsops/sops/releases/download/v${version}/${assetName}`;
    const destDir = join(ROOT, "platforms", `sops-${platform}`, "bin");
    const destPath = join(destDir, config.binName);

    console.log(`Downloading sops v${version} for ${platform}...`);
    console.log(`  URL: ${url}`);

    mkdirSync(destDir, { recursive: true });

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`  Failed: HTTP ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    // Stream to file and compute hash simultaneously
    const hash = createHash("sha256");
    const fileStream = createWriteStream(destPath);

    const reader = response.body.getReader();
    const writer = fileStream;

    // Read chunks, hash them, write them
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      writer.write(value);
    }
    writer.end();

    // Wait for file to finish writing
    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    const digest = hash.digest("hex");
    const expected = checksums[platform];

    if (!expected) {
      console.error(`  No checksum found for platform '${platform}' in sops-version.json`);
      process.exit(1);
    }

    if (digest !== expected) {
      console.error(`  CHECKSUM MISMATCH for ${platform}!`);
      console.error(`    Expected: ${expected}`);
      console.error(`    Got:      ${digest}`);
      process.exit(1);
    }

    console.log(`  Checksum verified: ${digest}`);

    // Make executable (no-op on Windows)
    if (config.binName !== "sops.exe") {
      chmodSync(destPath, 0o755);
    }

    console.log(`  Saved to: ${destPath}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
