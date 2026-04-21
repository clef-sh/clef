import { JsonEnvelopeBackend, PackBackendRegistry } from "@clef-sh/core";

/**
 * Build the default pack backend registry for the CLI. Registers the
 * built-in `json-envelope` backend eagerly.
 *
 * Future backends ship as sibling npm packages under `@clef-sh/pack-<name>`
 * and are discovered here via guarded dynamic imports (see the commented
 * scaffold below). Dynamic discovery is intentionally deferred until the
 * first plugin has a real customer — premature abstraction before then.
 */
export function createPackBackendRegistry(): PackBackendRegistry {
  const registry = new PackBackendRegistry();
  registry.register("json-envelope", () => new JsonEnvelopeBackend());

  // Future plugin discovery will look like this (mirroring
  // packages/cli/src/index.ts:134-158 for @clef-sh/cloud):
  //
  //   for (const name of ["aws-secrets-manager", "hashicorp-vault",
  //                       "gcp-secret-manager", "azure-key-vault", "aws-ssm"]) {
  //     try {
  //       const mod = await import(`@clef-sh/pack-${name}`);
  //       registry.register(name, () => new mod.default());
  //     } catch {
  //       // plugin not installed — skip
  //     }
  //   }

  return registry;
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
