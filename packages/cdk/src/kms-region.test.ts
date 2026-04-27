import { regionFromAwsKmsArn } from "./kms-region";

describe("regionFromAwsKmsArn", () => {
  it("extracts the region from a key ARN", () => {
    expect(regionFromAwsKmsArn("arn:aws:kms:us-east-1:123456789012:key/abc")).toBe("us-east-1");
  });

  it("extracts the region from an alias ARN", () => {
    expect(regionFromAwsKmsArn("arn:aws:kms:eu-west-2:123456789012:alias/my-key")).toBe(
      "eu-west-2",
    );
  });

  it("extracts the region from a GovCloud ARN", () => {
    expect(regionFromAwsKmsArn("arn:aws-us-gov:kms:us-gov-west-1:123456789012:key/abc")).toBe(
      "us-gov-west-1",
    );
  });

  it("extracts the region from a China partition ARN", () => {
    expect(regionFromAwsKmsArn("arn:aws-cn:kms:cn-north-1:123456789012:key/abc")).toBe(
      "cn-north-1",
    );
  });

  it("returns undefined for a bare key ID", () => {
    expect(regionFromAwsKmsArn("a0824f9f-758e-4477-8ab6-0d25fc7abe2e")).toBeUndefined();
  });

  it("returns undefined for a bare alias", () => {
    expect(regionFromAwsKmsArn("alias/my-key")).toBeUndefined();
  });
});
