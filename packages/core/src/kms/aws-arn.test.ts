import { validateAwsKmsArn } from "./aws-arn";

describe("validateAwsKmsArn", () => {
  describe("accepts well-formed ARNs", () => {
    it.each([
      "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
      "arn:aws:kms:eu-west-2:123456789012:alias/clef-quick-start",
      "arn:aws-us-gov:kms:us-gov-west-1:123456789012:key/some-uuid",
      "arn:aws-cn:kms:cn-north-1:123456789012:alias/foo",
    ])("%s", (arn) => {
      expect(validateAwsKmsArn(arn)).toEqual({ ok: true });
    });
  });

  describe("rejects malformed ARNs with specific reasons", () => {
    it("non-string", () => {
      const result = validateAwsKmsArn(undefined);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/must be a string/);
    });

    it("empty string", () => {
      const result = validateAwsKmsArn("");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/empty/);
    });

    it("bare alias name (no arn prefix)", () => {
      const result = validateAwsKmsArn("alias/clef-quick-start");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/starting with 'arn:'/);
    });

    it("bare key uuid", () => {
      const result = validateAwsKmsArn("abcd-1234-5678");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/starting with 'arn:'/);
    });

    it("empty region segment", () => {
      // The exact failure mode the user hit: $REGION was unset when the ARN
      // was assembled, leaving '::' between 'kms' and the account id.
      const result = validateAwsKmsArn("arn:aws:kms::136973030259:alias/clef-quick-start");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/region segment is empty/);
      expect(result.reason).toMatch(/\$REGION/);
    });

    it("malformed region", () => {
      const result = validateAwsKmsArn("arn:aws:kms:not-a-region:123456789012:key/x");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/doesn't look like an AWS region/);
    });

    it("empty account", () => {
      const result = validateAwsKmsArn("arn:aws:kms:us-east-1::key/x");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/account segment is empty/);
    });

    it("non-12-digit account", () => {
      const result = validateAwsKmsArn("arn:aws:kms:us-east-1:12345:key/x");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/12 digits/);
    });

    it("missing resource segment (only 5 colons)", () => {
      const result = validateAwsKmsArn("arn:aws:kms:us-east-1:123456789012");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/6 colon-delimited segments/);
    });

    it("too many segments", () => {
      const result = validateAwsKmsArn("arn:aws:kms:us-east-1:123456789012:key/with:colon");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/exactly 6 colon-delimited segments/);
    });

    it("unknown partition", () => {
      const result = validateAwsKmsArn("arn:foo:kms:us-east-1:123456789012:key/x");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/partition segment.*not recognized/);
    });

    it("wrong service", () => {
      const result = validateAwsKmsArn("arn:aws:s3:us-east-1:123456789012:key/x");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/service segment must be 'kms'/);
    });

    it("resource without key/ or alias/ prefix", () => {
      const result = validateAwsKmsArn("arn:aws:kms:us-east-1:123456789012:thing/x");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/'key\/' or 'alias\/'/);
    });

    it("empty key/ id", () => {
      const result = validateAwsKmsArn("arn:aws:kms:us-east-1:123456789012:key/");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/empty after 'key\/' or 'alias\/'/);
    });
  });
});
