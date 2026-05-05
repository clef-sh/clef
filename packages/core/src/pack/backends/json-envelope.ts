import { ArtifactPacker } from "../../artifact/packer";
import { FilePackOutput } from "../../artifact/output";
import { MatrixManager } from "../../matrix/manager";
import type { PackOutput } from "../../artifact/types";
import type { BackendPackResult, PackBackend, PackRequest } from "../types";

/**
 * Options specific to the {@link JsonEnvelopeBackend}. At least one of
 * `outputPath` or `output` must be provided; `signingKey` and
 * `signingKmsKeyId` are mutually exclusive.
 */
export interface JsonEnvelopeOptions {
  /** Local file path for the artifact JSON. Used when `output` is not provided. */
  outputPath?: string;
  /**
   * Pre-constructed output backend. Takes precedence over `outputPath`.
   * Used by `clef serve` with {@link MemoryPackOutput} to avoid disk I/O.
   */
  output?: PackOutput;
  /** Ed25519 private key for artifact signing (base64 DER PKCS8). */
  signingKey?: string;
  /** KMS asymmetric signing key ARN/ID (ECDSA_SHA_256). Mutually exclusive with signingKey. */
  signingKmsKeyId?: string;
}

/**
 * Default pack backend. Produces the canonical Clef JSON artifact
 * envelope (age-encrypted for age identities, AES-256-GCM with
 * KMS-wrapped DEK for KMS-envelope identities) and writes it to
 * a file or a provided output adapter.
 */
export class JsonEnvelopeBackend implements PackBackend {
  readonly id = "json-envelope";
  readonly description = "Write the Clef JSON artifact envelope to a local file (default).";

  validateOptions(raw: Record<string, unknown>): void {
    const opts = raw as JsonEnvelopeOptions;
    if (opts.signingKey && opts.signingKmsKeyId) {
      throw new Error(
        "Cannot specify both signingKey (Ed25519) and signingKmsKeyId (KMS). Choose one.",
      );
    }
    if (!opts.outputPath && !opts.output) {
      throw new Error("json-envelope backend requires an 'outputPath' or 'output' option.");
    }
  }

  async pack(req: PackRequest): Promise<BackendPackResult> {
    const opts = req.backendOptions as JsonEnvelopeOptions;
    const packer = new ArtifactPacker(req.services.source, new MatrixManager(), req.services.kms);
    const output =
      opts.output ?? (opts.outputPath ? new FilePackOutput(opts.outputPath) : undefined);
    const result = await packer.pack(
      {
        identity: req.identity,
        environment: req.environment,
        outputPath: opts.outputPath,
        output,
        ttl: req.ttl,
        signingKey: opts.signingKey,
        signingKmsKeyId: opts.signingKmsKeyId,
      },
      req.manifest,
      req.repoRoot,
    );
    return {
      ...result,
      backend: this.id,
      details: {
        outputPath: opts.outputPath ?? null,
      },
    };
  }
}
