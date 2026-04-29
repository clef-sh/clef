/**
 * AWS KMS ARN validator with specific failure reasons.
 *
 * The parser already used a single regex (`AWS_KMS_ARN_PATTERN`) to accept-or-
 * reject keyIds, but the failure message was generic. This validator walks the
 * ARN segment-by-segment and returns a reason that points at the actual fault
 * — empty region, malformed account, missing `key/`/`alias/`, etc. — so users
 * fix the right segment without trial-and-error.
 *
 * Accepted forms:
 *   - arn:aws:kms:<region>:<account>:key/<key-id>
 *   - arn:aws:kms:<region>:<account>:alias/<name>
 *   - arn:aws-<partition>:kms:... (gov, cn, etc.)
 *
 * Bare key UUIDs and bare aliases are rejected — region must be derivable
 * from the ARN at synth time.
 */

export interface AwsKmsArnValidation {
  ok: boolean;
  /** Human-readable reason. Present when `ok` is `false`. */
  reason?: string;
}

const PARTITION_PATTERN = /^aws(?:-[a-z]+)*$/;
// Three+ hyphenated lowercase segments ending in a digit suffix:
// `us-east-1`, `eu-west-2`, `ap-southeast-3`, `us-gov-west-1`, `cn-north-1`.
const REGION_PATTERN = /^[a-z]{2,}(?:-[a-z]+)+-\d+$/;
const ACCOUNT_PATTERN = /^\d{12}$/;

/**
 * Validate an AWS KMS key or alias ARN. Returns `{ ok: true }` on a well-
 * formed ARN, otherwise `{ ok: false, reason }` with a message that names the
 * faulty segment.
 */
export function validateAwsKmsArn(input: unknown): AwsKmsArnValidation {
  if (typeof input !== "string") {
    return { ok: false, reason: "value must be a string" };
  }
  if (input.length === 0) {
    return { ok: false, reason: "value is empty" };
  }
  if (!input.startsWith("arn:")) {
    return {
      ok: false,
      reason:
        "expected an ARN starting with 'arn:' (got a bare key id, alias name, or other format). " +
        "Use a full ARN like 'arn:aws:kms:us-east-1:123456789012:alias/<name>'.",
    };
  }

  const segments = input.split(":");
  if (segments.length < 6) {
    return {
      ok: false,
      reason:
        `expected 6 colon-delimited segments (arn:aws:kms:<region>:<account>:<resource>), got ${segments.length}. ` +
        "Check that the region and account aren't missing.",
    };
  }
  if (segments.length > 6) {
    return {
      ok: false,
      reason: `expected exactly 6 colon-delimited segments, got ${segments.length}. Check for stray ':' characters.`,
    };
  }

  const [, partition, service, region, account, resource] = segments;

  if (!PARTITION_PATTERN.test(partition)) {
    return {
      ok: false,
      reason: `partition segment '${partition}' is not recognized. Expected 'aws', 'aws-us-gov', 'aws-cn', etc.`,
    };
  }
  if (service !== "kms") {
    return {
      ok: false,
      reason: `service segment must be 'kms', got '${service}'.`,
    };
  }
  if (region.length === 0) {
    return {
      ok: false,
      reason:
        "region segment is empty (look for '::' between 'kms' and the account id). " +
        "Set a region like 'us-east-1' before reconstructing the ARN — common cause: a $REGION shell variable was unset when the ARN was built.",
    };
  }
  if (!REGION_PATTERN.test(region)) {
    return {
      ok: false,
      reason: `region segment '${region}' doesn't look like an AWS region (expected e.g. 'us-east-1', 'eu-west-2').`,
    };
  }
  if (account.length === 0) {
    return {
      ok: false,
      reason: "account segment is empty. Provide the 12-digit AWS account id.",
    };
  }
  if (!ACCOUNT_PATTERN.test(account)) {
    return {
      ok: false,
      reason: `account segment '${account}' must be exactly 12 digits.`,
    };
  }
  if (!resource || resource.length === 0) {
    return {
      ok: false,
      reason: "resource segment is empty. Expected 'key/<id>' or 'alias/<name>' after the account.",
    };
  }
  if (!resource.startsWith("key/") && !resource.startsWith("alias/")) {
    return {
      ok: false,
      reason: `resource '${resource}' must start with 'key/' or 'alias/'.`,
    };
  }
  if (resource === "key/" || resource === "alias/") {
    return {
      ok: false,
      reason: "resource id is empty after 'key/' or 'alias/'.",
    };
  }

  return { ok: true };
}
