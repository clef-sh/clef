/**
 * Adapter exposing the bundled `SopsClient`'s blob-shaped methods as a
 * substrate-agnostic `EncryptionBackend`. This is the default and only
 * first-party `EncryptionBackend` — any future custom backend ships
 * separately.
 *
 * Why an adapter rather than `class SopsClient implements
 * EncryptionBackend`: SopsClient still carries the legacy file-path
 * methods (`encrypt(filePath, ...)`, `decrypt(filePath)`, etc.) that
 * Phase 5 consumers depend on. Folding both surfaces into one class
 * would create method-name collisions (`encrypt(filePath, ...)` vs
 * `encrypt(values, ctx)`). The adapter keeps the legacy class intact
 * and surfaces only the substrate-agnostic shape.
 */
import type { SopsClient } from "../sops/client";
import type { EncryptionBackend, EncryptionContext, RotateOptions } from "./encryption-backend";
import type { DecryptedFile, SopsMetadata } from "../types";

export function createSopsEncryptionBackend(client: SopsClient): EncryptionBackend {
  return {
    id: "sops",
    description: "SOPS-based encryption via the bundled `sops` binary",

    encrypt(values: Record<string, string>, ctx: EncryptionContext): Promise<string> {
      return client.encryptBlob(values, ctx.manifest, ctx.environment, ctx.format);
    },

    decrypt(blob: string, ctx: EncryptionContext): Promise<DecryptedFile> {
      return client.decryptBlob(blob, ctx.format);
    },

    rotate(blob: string, opts: RotateOptions, ctx: EncryptionContext): Promise<string> {
      return client.rotateBlob(blob, opts, ctx.format);
    },

    getMetadata(blob: string): SopsMetadata {
      return client.getMetadataFromBlob(blob);
    },

    validateEncryption(blob: string): boolean {
      return client.validateEncryptionBlob(blob);
    },
  };
}
