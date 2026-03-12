import { validateAgePublicKey, keyPreview } from "./validator";

describe("validateAgePublicKey", () => {
  // A realistic age public key (62 chars, valid bech32 after age1)
  const validKey = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";

  it("accepts a valid age public key", () => {
    const result = validateAgePublicKey(validKey);
    expect(result).toEqual({ valid: true, key: validKey });
  });

  it("rejects a key with wrong prefix", () => {
    const result = validateAgePublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must start with 'age1'");
  });

  it("rejects a key that is too short", () => {
    const result = validateAgePublicKey("age1abc");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too short");
  });

  it("rejects a key with invalid bech32 characters", () => {
    // 'b' is not in the bech32 charset
    const result = validateAgePublicKey(
      "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcacb",
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid character 'b'");
  });

  it("rejects a key with uppercase characters", () => {
    const result = validateAgePublicKey("age1QL3Z7HJY54PW3HYWW5AYYFG7ZQGVC7W3J2ELW8");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid character");
  });

  it("trims whitespace from input", () => {
    const result = validateAgePublicKey(`  ${validKey}  `);
    expect(result).toEqual({ valid: true, key: validKey });
  });

  it("trims newlines from input", () => {
    const result = validateAgePublicKey(`\n${validKey}\n`);
    expect(result).toEqual({ valid: true, key: validKey });
  });

  it("rejects empty string", () => {
    const result = validateAgePublicKey("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("must start with 'age1'");
  });
});

describe("keyPreview", () => {
  it("returns age1 ellipsis plus last 8 characters", () => {
    const key = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";
    const preview = keyPreview(key);
    expect(preview).toBe("age1\u2026aqmcac8p");
  });

  it("uses the correct last 8 characters for different keys", () => {
    const key = "age1xyz9876543210abcdefghijklmnopqrstuvwxyz";
    const preview = keyPreview(key);
    expect(preview).toBe("age1\u2026stuvwxyz");
  });
});
