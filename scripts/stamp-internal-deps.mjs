#!/usr/bin/env node

/**
 * Pin every in-monorepo @clef-sh/* dependency to the exact current
 * version of the matching workspace package.
 *
 * Context: our package.json files reference sibling workspaces with
 * loose specifiers like `"@clef-sh/core": "*"` or `">=0.1.0"`. npm
 * workspaces resolves these locally at dev time, but `npm publish`
 * emits them verbatim. That means a @clef-sh/cli@0.1.8-beta.52 would
 * depend on whatever `@clef-sh/core` npm resolves `*` to at install
 * time — almost always the latest stable, not the matching beta.
 * Prerelease fixes get masked; mixed-version installs break at runtime.
 *
 * This script runs after the publish workflows stamp per-package
 * versions. It walks every workspace listed in the root package.json,
 * collects `{name -> version}`, then rewrites every dep entry that
 * names a monorepo package to the exact version of that package.
 *
 * External `@clef-sh/*` packages (e.g. @clef-sh/sops-*,
 * @clef-sh/keyservice-*) are NOT touched — they version independently
 * of the main release cadence.
 *
 * Usage:
 *   node scripts/stamp-internal-deps.mjs
 *
 * Idempotent: re-runs produce no diff if deps are already pinned.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const rootPkgPath = path.join(root, "package.json");
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
const workspaces = rootPkg.workspaces ?? [];

/** Collect name -> version for every workspace that lives in this monorepo. */
const versions = new Map();
for (const ws of workspaces) {
  const pkgPath = path.join(root, ws, "package.json");
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  if (typeof pkg.name !== "string" || !pkg.name.startsWith("@clef-sh/")) continue;
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    console.error(`::error::${pkg.name} has no version in ${pkgPath}`);
    process.exit(1);
  }
  versions.set(pkg.name, pkg.version);
}

if (versions.size === 0) {
  console.error("::error::No @clef-sh/* workspaces found — aborting");
  process.exit(1);
}

/**
 * Rewrite every dep field that names a known workspace. We touch
 * dependencies, peerDependencies, optionalDependencies, AND
 * devDependencies: the last is not installed by consumers, but pinning
 * it keeps the published package.json internally consistent.
 */
const FIELDS = ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"];
let touched = 0;

for (const ws of workspaces) {
  const pkgPath = path.join(root, ws, "package.json");
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  let changed = false;

  for (const field of FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object") continue;
    for (const name of Object.keys(deps)) {
      if (!versions.has(name)) continue;
      const target = versions.get(name);
      if (deps[name] !== target) {
        console.log(`  ${pkg.name} ${field}.${name}: ${deps[name]} → ${target}`);
        deps[name] = target;
        changed = true;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    touched++;
  }
}

console.log(`stamp-internal-deps: ${touched} package.json file(s) updated`);
