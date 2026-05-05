import { ClefError } from "../types";

/**
 * Thrown when a CLI command or UI route requires a capability the
 * configured `SecretSource` does not implement (e.g. running
 * `clef rotate` against a `postgres` source that does not implement
 * `Rotatable`).
 *
 * Surfaces at the command-entry boundary so users see a clean message
 * rather than a deep stack trace from a missing method call. The
 * `capability` field is the trait name in lower-case kebab form
 * (`"rotate"`, `"recipients"`, `"merge"`, etc.) — matching the keys of
 * `SourceCapabilities`.
 */
export class SourceCapabilityUnsupportedError extends ClefError {
  constructor(
    public readonly capability: string,
    public readonly sourceId: string,
  ) {
    super(
      `'${capability}' is not supported by the '${sourceId}' source.`,
      `Switch to a source that implements ${capability}, or use a different command.`,
    );
    this.name = "SourceCapabilityUnsupportedError";
  }
}
