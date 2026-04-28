import { JsonEnvelopeBackend, PackBackendRegistry } from "@clef-sh/core";
import type { PackBackend } from "@clef-sh/core";
import { AwsParameterStoreBackend } from "@clef-sh/pack-aws-parameter-store";
import { AwsSecretsManagerBackend } from "@clef-sh/pack-aws-secrets-manager";

/**
 * Build the default pack backend registry for the CLI. Registers the
 * bundled built-ins:
 *
 *   - `json-envelope` — the default, writes the encrypted Clef envelope.
 *   - `aws-parameter-store` — AWS SSM Parameter Store, bundled.
 *   - `aws-secrets-manager` — AWS Secrets Manager, bundled.
 *
 * Both AWS plugins ship inside the CLI (esbuild aliases their TypeScript
 * sources at build time), so `--backend aws-parameter-store` /
 * `--backend aws-secrets-manager` work in the SEA binary without any
 * additional install. Community plugins under `@clef-sh/pack-<name>` or
 * `clef-pack-<name>` are still discoverable via dynamic import in
 * {@link resolveBackend}.
 */
export function createPackBackendRegistry(): PackBackendRegistry {
  const registry = new PackBackendRegistry();
  registry.register("json-envelope", () => new JsonEnvelopeBackend());
  registry.register("aws-parameter-store", () => new AwsParameterStoreBackend());
  registry.register("aws-secrets-manager", () => new AwsSecretsManagerBackend());
  return registry;
}

/**
 * Resolve a pack backend by id. Checks the built-in registry first, then
 * tries optional npm plugin packages using naming conventions.
 *
 * Resolution order:
 *   1. Built-in `registry` (e.g. `json-envelope`).
 *   2. If the id starts with `@` or contains `/`, treat as a verbatim npm
 *      package name (e.g. `@acme/clef-pack-foo`).
 *   3. `@clef-sh/pack-<id>` (official prefix).
 *   4. `clef-pack-<id>` (community prefix).
 *   5. Fail with an install hint.
 *
 * Plugin packages must default-export a valid `PackBackend` object (an
 * object with at least `id: string` and `pack: (req) => Promise<...>`).
 * Non-conforming exports are rejected with a clear error.
 */
export async function resolveBackend(
  registry: PackBackendRegistry,
  id: string,
): Promise<PackBackend> {
  if (registry.has(id)) {
    return registry.resolve(id);
  }

  if (id.startsWith("@") || id.includes("/")) {
    return loadPlugin(id);
  }

  const official = `@clef-sh/pack-${id}`;
  try {
    return await loadPlugin(official);
  } catch (err) {
    if (!isModuleNotFoundError(err, official)) throw err;
  }

  const community = `clef-pack-${id}`;
  try {
    return await loadPlugin(community);
  } catch (err) {
    if (!isModuleNotFoundError(err, community)) throw err;
  }

  throw new Error(
    [
      `Unknown pack backend "${id}". Built-in backends: ${registry.list().join(", ")}.`,
      `To use a plugin, install one of:`,
      `  npm install --save-dev ${official}`,
      `  npm install --save-dev ${community}`,
    ].join("\n"),
  );
}

async function loadPlugin(packageName: string): Promise<PackBackend> {
  const mod = (await import(packageName)) as Record<string, unknown>;
  const candidate = extractBackend(mod);
  if (!candidate) {
    throw new Error(
      `Plugin "${packageName}" does not export a valid PackBackend. ` +
        `Expected a default export with 'id: string' and 'pack(req)' at minimum.`,
    );
  }
  return candidate;
}

/**
 * Extract a PackBackend from a module namespace, accepting the three
 * common shapes produced by Node + bundlers + ESM/CJS interop:
 *   - ESM default export:         `mod.default`
 *   - CJS default-interop wrap:   `mod.default.default`
 *   - Bare CJS module.exports:    `mod` itself
 * First match wins.
 */
function extractBackend(mod: Record<string, unknown>): PackBackend | null {
  if (isValidPackBackend(mod.default)) return mod.default;
  const nested = (mod.default as Record<string, unknown> | undefined)?.default;
  if (isValidPackBackend(nested)) return nested;
  if (isValidPackBackend(mod)) return mod as unknown as PackBackend;
  return null;
}

function isValidPackBackend(x: unknown): x is PackBackend {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.pack === "function";
}

/**
 * Returns true when `err` is a module-not-found error referring
 * specifically to `packageName`. Distinguishes "the plugin itself is
 * not installed" (skip to the next resolution step) from "the plugin
 * failed to load because of its own transitive import" (surface the
 * error — the user installed something broken).
 *
 * Covers the message variants across runtimes:
 *   - Node ESM dynamic import → "Cannot find package 'X' imported from Y"
 *     with code ERR_MODULE_NOT_FOUND
 *   - Node CJS require → "Cannot find module 'X'" with code MODULE_NOT_FOUND
 *   - Jest (jest-resolve) → "Cannot find module 'X' from 'Y'"
 * All variants embed the package name in quotes.
 */
function isModuleNotFoundError(err: unknown, packageName: string): boolean {
  // Accept either a real Error instance or any object with a string `message`.
  // Jest's module resolver throws plain objects whose `err instanceof Error`
  // is false but the shape matches; we still want to treat them as not-found.
  const msg = extractMessage(err);
  if (msg === null) return false;
  const looksLikeNotFound =
    msg.startsWith("Cannot find module") || msg.startsWith("Cannot find package");
  if (!looksLikeNotFound) return false;
  return msg.includes(`'${packageName}'`) || msg.includes(`"${packageName}"`);
}

function extractMessage(err: unknown): string | null {
  if (typeof err === "string") return err;
  if (
    err &&
    typeof err === "object" &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return null;
}

/**
 * Parse a repeatable `--backend-opt key=value` accumulator into a typed map.
 *
 * Values may contain `=` — only the first `=` is treated as the delimiter
 * (matches the `parseKmsEnvMappings` convention in `service.ts` so keys
 * like `tags=a=b` and base64 padding survive).
 *
 * Throws on malformed input and duplicate keys so problems surface with
 * the offending pair rather than silently swallowing either side.
 */
export function parseBackendOptions(raw: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of raw) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx === -1) {
      throw new Error(`Invalid --backend-opt format: '${entry}'. Expected: key=value`);
    }
    const key = entry.slice(0, eqIdx);
    const value = entry.slice(eqIdx + 1);
    if (key.length === 0) {
      throw new Error(`Invalid --backend-opt format: '${entry}'. Key must not be empty.`);
    }
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`Duplicate --backend-opt key: '${key}'.`);
    }
    result[key] = value;
  }
  return result;
}
