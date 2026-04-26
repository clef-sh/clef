import * as crypto from "crypto";

/**
 * Parse a signer-key argument into a base64-encoded DER SPKI public key
 * suitable for `verifySignature`.
 *
 * Input precedence:
 *   1. Starts with `-----BEGIN`              → parsed as PEM (any public-key type).
 *   2. Otherwise                             → treated as an already-base64 DER SPKI.
 *
 * The base64 branch is validated by round-tripping through `createPublicKey`
 * so malformed input fails here, not deep inside verify.
 *
 * This function never touches the filesystem. CLI callers that want to accept
 * a `--signer-key-file <path>` flag must read the file themselves and pass
 * the contents in — that keeps the file-read sink at an explicit operator
 * boundary rather than smuggling it inside a parser.
 */
export function parseSignerKey(input: string): string {
  const trimmed = input.trim();

  if (trimmed.startsWith("-----BEGIN")) {
    return pemToBase64Der(trimmed);
  }

  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(trimmed, "base64"),
      format: "der",
      type: "spki",
    });
    // Re-export to normalize — tolerates base64 whitespace in the input.
    return (key.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
  } catch (err) {
    throw new Error(
      `signer key could not be parsed as PEM or a base64 DER SPKI key: ${(err as Error).message}`,
    );
  }
}

function pemToBase64Der(pem: string): string {
  try {
    const key = crypto.createPublicKey({ key: pem, format: "pem" });
    return (key.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
  } catch (err) {
    throw new Error(`signer key PEM is invalid: ${(err as Error).message}`);
  }
}
