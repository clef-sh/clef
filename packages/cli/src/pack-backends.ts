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
