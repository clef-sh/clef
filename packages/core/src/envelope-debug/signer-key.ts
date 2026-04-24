import * as crypto from "crypto";
import * as fs from "fs";

/**
 * Options for {@link parseSignerKey}.
 *
 * `allowFilePaths` gates the file-read branch. The CLI opts in
 * (`--signer-key /path/to/key.pem` is convenient for operators).
 * The UI server leaves it off — it only accepts pasted PEM strings or
 * base64 DER SPKI, never a server-side filesystem path (decision D4:
 * UI is paste-only, no server file reads on behalf of the client).
 */
export interface ParseSignerKeyOptions {
  /**
   * When true, an input that is not PEM-shaped is `fs.statSync`-checked
   * and read as a file if it exists. Defaults to false.
   */
  allowFilePaths?: boolean;
}

/**
 * Parse a signer-key argument into a base64-encoded DER SPKI public key
 * suitable for `verifySignature`.
 *
 * Input precedence:
 *   1. Starts with `-----BEGIN`              → parsed as PEM (any public-key type).
 *   2. Existing file path (opt-in)           → read from disk, then re-enter
 *                                              this function on the file's contents.
 *   3. Otherwise                             → treated as an already-base64 DER SPKI.
 *
 * The base64 branch is validated by round-tripping through `createPublicKey`
 * so malformed input fails here, not deep inside verify.
 */
export function parseSignerKey(input: string, opts?: ParseSignerKeyOptions): string {
  const trimmed = input.trim();

  if (trimmed.startsWith("-----BEGIN")) {
    return pemToBase64Der(trimmed);
  }

  if (opts?.allowFilePaths && isExistingFile(trimmed)) {
    const contents = fs.readFileSync(trimmed, "utf-8").trim();
    return parseSignerKey(contents, opts);
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
    const suffix = opts?.allowFilePaths ? ", a readable file path," : "";
    throw new Error(
      `signer key could not be parsed as PEM${suffix} or a base64 DER SPKI key: ${
        (err as Error).message
      }`,
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

function isExistingFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
