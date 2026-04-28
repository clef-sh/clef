/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * Wraps and unwraps PKCS#11 URIs as synthetic AWS KMS ARNs so they pass
 * through SOPS's `--kms` validation regex. Every encrypted file with
 * backend `hsm` stores its key identifier as a Clef-shaped ARN; the
 * clef-keyservice side decodes it back to a pkcs11 URI before handing
 * the DEK wrap/unwrap to the HSM.
 *
 * Contract v1 — frozen with the clef-keyservice team:
 *
 *   arn:aws:kms:us-east-1:000000000000:alias/clef-hsm/v1/<BASE64URL(pkcs11-uri)>
 *
 * - Region / account are placeholders. SOPS never dials AWS because
 *   `--enable-local-keyservice=false` routes every KMS op to the
 *   keyservice sidecar.
 * - Payload is RFC 4648 §5 base64url, no padding. Alphabet is
 *   `[A-Za-z0-9_-]`, which is why the regex below ends with `+$`
 *   over that exact class.
 * - Version marker lets us evolve the encoding if RFC 7512 extensions
 *   push us to a different format — bump to `v2` on both sides.
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 */

/** Canonical regex both sides (CLI + keyservice) validate against. */
const CLEF_HSM_ARN_RE = /^arn:aws[\w-]*:kms:[^:]+:\d+:alias\/clef-hsm\/(v\d+)\/([A-Za-z0-9_-]+)$/;

/** Fixed ARN prefix emitted by the CLI. Region/account are placeholders. */
const ARN_PREFIX = "arn:aws:kms:us-east-1:000000000000:alias/clef-hsm/v1/";

/** Wire-format version understood by this module. Keyservice rejects other v values with UNIMPLEMENTED. */
const SUPPORTED_VERSION = "v1";

/**
 * Wrap a pkcs11 URI in a Clef HSM synthetic ARN.
 *
 * @param uri - A pkcs11 URI (e.g. `pkcs11:slot=0;label=clef-dek-wrapper`).
 * @returns An ARN that passes SOPS's `--kms` regex and carries the URI as payload.
 * @throws If `uri` does not start with `pkcs11:`.
 */
export function pkcs11UriToSyntheticArn(uri: string): string {
  if (!uri.startsWith("pkcs11:")) {
    throw new Error(`Expected a pkcs11 URI starting with 'pkcs11:', got '${uri}'.`);
  }
  const payload = Buffer.from(uri, "utf8").toString("base64url");
  const arn = ARN_PREFIX + payload;
  // Self-check: the ARN we just built must round-trip through our own regex.
  // Catches accidental breakage if ARN_PREFIX or the encoding ever drifts.
  if (!CLEF_HSM_ARN_RE.test(arn)) {
    throw new Error(`Synthesized ARN failed self-validation: '${arn}'.`);
  }
  return arn;
}

/**
 * Decode a Clef HSM synthetic ARN back to its pkcs11 URI.
 *
 * @param arn - A string that may or may not be a Clef HSM ARN.
 * @returns The pkcs11 URI if `arn` matches the contract; `null` otherwise.
 *   Returning `null` (rather than throwing) lets callers branch cleanly
 *   between "this is a Clef HSM ARN" and "this is some other KMS ARN".
 *   Callers that require a valid decode should throw themselves.
 */
export function syntheticArnToPkcs11Uri(arn: string): string | null {
  const match = CLEF_HSM_ARN_RE.exec(arn);
  if (!match) return null;
  const [, version, payload] = match;
  if (version !== SUPPORTED_VERSION) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!decoded.startsWith("pkcs11:")) return null;
  return decoded;
}

/**
 * Check whether a string is a Clef HSM synthetic ARN (regardless of
 * whether its payload decodes cleanly).
 *
 * Used by `SopsClient` (its private backend-detection path) to classify
 * entries in `sops.kms[]` as `hsm` rather than `awskms`.
 */
export function isClefHsmArn(arn: string): boolean {
  return CLEF_HSM_ARN_RE.test(arn);
}
