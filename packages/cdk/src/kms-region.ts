/**
 * Extract the region segment from an AWS KMS key/alias ARN.
 *
 * The manifest parser refuses non-ARN AWS keyIds, so by the time a
 * `KmsConfig` reaches CDK code the region is always recoverable from the ARN.
 * Returns undefined for non-ARN inputs as a defensive fallback only.
 */
export function regionFromAwsKmsArn(keyId: string): string | undefined {
  const m = /^arn:aws(?:-[a-z]+)*:kms:([^:]+):/.exec(keyId);
  return m?.[1];
}
