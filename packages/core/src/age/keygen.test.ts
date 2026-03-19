import { generateAgeIdentity, deriveAgePublicKey, formatAgeKeyFile } from "./keygen";

const MOCK_PRIVATE_KEY = "AGE-SECRET-KEY-1MOCKPRIVATEKEY1234";
const MOCK_PUBLIC_KEY = "age1qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn5";

describe("generateAgeIdentity", () => {
  it("should return a private key and public key", async () => {
    const identity = await generateAgeIdentity();
    expect(identity.privateKey).toBe(MOCK_PRIVATE_KEY);
    expect(identity.publicKey).toBe(MOCK_PUBLIC_KEY);
  });

  it("should derive public key from private key", async () => {
    const identity = await generateAgeIdentity();
    expect(identity.publicKey).toMatch(/^age1/);
  });
});

describe("deriveAgePublicKey", () => {
  it("should return a string matching /^age1/", async () => {
    const publicKey = await deriveAgePublicKey(MOCK_PRIVATE_KEY);
    expect(publicKey).toMatch(/^age1/);
  });

  it("should return the expected mock public key", async () => {
    const publicKey = await deriveAgePublicKey(MOCK_PRIVATE_KEY);
    expect(publicKey).toBe(MOCK_PUBLIC_KEY);
  });
});

describe("formatAgeKeyFile", () => {
  it("should include a timestamp comment", () => {
    const result = formatAgeKeyFile(MOCK_PRIVATE_KEY, MOCK_PUBLIC_KEY);
    expect(result).toMatch(/^# created: \d{4}-\d{2}-\d{2}T/);
  });

  it("should include the public key comment", () => {
    const result = formatAgeKeyFile(MOCK_PRIVATE_KEY, MOCK_PUBLIC_KEY);
    expect(result).toContain(`# public key: ${MOCK_PUBLIC_KEY}`);
  });

  it("should include the private key", () => {
    const result = formatAgeKeyFile(MOCK_PRIVATE_KEY, MOCK_PUBLIC_KEY);
    expect(result).toContain(MOCK_PRIVATE_KEY);
  });

  it("should end with a newline", () => {
    const result = formatAgeKeyFile(MOCK_PRIVATE_KEY, MOCK_PUBLIC_KEY);
    expect(result.endsWith("\n")).toBe(true);
  });
});
