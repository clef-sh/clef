import * as crypto from "crypto";

/**
 * Compute the canonical SHA-256 hash of an artifact's base64-encoded ciphertext.
 *
 * Used by the packer to populate `PackedArtifact.ciphertextHash`, by the runtime
 * to verify integrity on fetch, and by the envelope debugger to recompute on
 * inspect. A single implementation across all three sites prevents silent
 * divergence that would hide corruption.
 */
export function computeCiphertextHash(ciphertext: string): string {
  return crypto.createHash("sha256").update(ciphertext).digest("hex");
}
