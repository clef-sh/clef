import * as fs from "fs";
import { AgeDecryptor } from "./decrypt";

jest.mock("fs");
jest.mock(
  "age-encryption",
  () => ({
    Decrypter: jest.fn().mockImplementation(() => ({
      addIdentity: jest.fn(),
      decrypt: jest.fn().mockResolvedValue('{"KEY":"decrypted-value"}'),
    })),
  }),
  { virtual: true },
);

const mockFs = fs as jest.Mocked<typeof fs>;

describe("AgeDecryptor", () => {
  let decryptor: AgeDecryptor;

  beforeEach(() => {
    jest.clearAllMocks();
    decryptor = new AgeDecryptor();
  });

  describe("decrypt", () => {
    it("should decrypt ciphertext using age-encryption", async () => {
      const result = await decryptor.decrypt("age-ciphertext", "AGE-SECRET-KEY-1TEST");
      expect(result).toBe('{"KEY":"decrypted-value"}');
    });

    it("should call addIdentity with the provided private key", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Decrypter } = require("age-encryption");
      await decryptor.decrypt("age-ciphertext", "AGE-SECRET-KEY-1TEST");
      const latest = Decrypter.mock.results[Decrypter.mock.results.length - 1].value;
      expect(latest.addIdentity).toHaveBeenCalledWith("AGE-SECRET-KEY-1TEST");
    });

    it("should call decrypt with ciphertext and 'text' format", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Decrypter } = require("age-encryption");
      await decryptor.decrypt("age-ciphertext-payload", "AGE-SECRET-KEY-1TEST");
      const latest = Decrypter.mock.results[Decrypter.mock.results.length - 1].value;
      expect(latest.decrypt).toHaveBeenCalledWith("age-ciphertext-payload", "text");
    });
  });

  describe("resolveKey", () => {
    it("should return inline key when ageKey is provided", () => {
      const key = decryptor.resolveKey("AGE-SECRET-KEY-1INLINE  ", undefined);
      expect(key).toBe("AGE-SECRET-KEY-1INLINE");
    });

    it("should read key from file when ageKeyFile is provided", () => {
      mockFs.readFileSync.mockReturnValue(
        "# created: 2024-01-01\n# public key: age1abc\nAGE-SECRET-KEY-1FROMFILE\n",
      );

      const key = decryptor.resolveKey(undefined, "/path/to/key.txt");
      expect(key).toBe("AGE-SECRET-KEY-1FROMFILE");
      expect(mockFs.readFileSync).toHaveBeenCalledWith("/path/to/key.txt", "utf-8");
    });

    it("should throw when key file contains no age secret key", () => {
      mockFs.readFileSync.mockReturnValue("no key here\n");

      expect(() => decryptor.resolveKey(undefined, "/path/to/bad.txt")).toThrow(
        "No age secret key found",
      );
    });

    it("should throw when neither key nor file is provided", () => {
      expect(() => decryptor.resolveKey(undefined, undefined)).toThrow("No age key available");
    });

    it("should prefer ageKey over ageKeyFile", () => {
      const key = decryptor.resolveKey("AGE-SECRET-KEY-1INLINE", "/path/to/key.txt");
      expect(key).toBe("AGE-SECRET-KEY-1INLINE");
      expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });
  });
});
