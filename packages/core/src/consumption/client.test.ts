import { ConsumptionClient } from "./client";
import { DecryptedFile } from "../types";

const client = new ConsumptionClient();

const mockDecrypted: DecryptedFile = {
  values: {
    DATABASE_URL: "postgres://localhost/myapp",
    DATABASE_POOL: "10",
    API_KEY: "sk-secret-123",
  },
  metadata: {
    backend: "age",
    recipients: ["age1abc"],
    lastModified: new Date("2024-01-15"),
  },
};

describe("ConsumptionClient", () => {
  describe("prepareEnvironment", () => {
    it("should merge decrypted values into base environment", () => {
      const result = client.prepareEnvironment(mockDecrypted, {
        PATH: "/usr/bin",
        HOME: "/home/user",
      });

      expect(result.PATH).toBe("/usr/bin");
      expect(result.HOME).toBe("/home/user");
      expect(result.DATABASE_URL).toBe("postgres://localhost/myapp");
      expect(result.DATABASE_POOL).toBe("10");
      expect(result.API_KEY).toBe("sk-secret-123");
    });

    it("should filter keys with --only option", () => {
      const result = client.prepareEnvironment(mockDecrypted, {}, { only: ["DATABASE_URL"] });

      expect(result.DATABASE_URL).toBe("postgres://localhost/myapp");
      expect(result.DATABASE_POOL).toBeUndefined();
      expect(result.API_KEY).toBeUndefined();
    });

    it("should prefix keys with --prefix option", () => {
      const result = client.prepareEnvironment(mockDecrypted, {}, { prefix: "APP_" });

      expect(result.APP_DATABASE_URL).toBe("postgres://localhost/myapp");
      expect(result.APP_DATABASE_POOL).toBe("10");
      expect(result.APP_API_KEY).toBe("sk-secret-123");
      expect(result.DATABASE_URL).toBeUndefined();
    });

    it("should not override existing keys with --no-override", () => {
      const result = client.prepareEnvironment(
        mockDecrypted,
        { DATABASE_URL: "existing-value" },
        { noOverride: true },
      );

      expect(result.DATABASE_URL).toBe("existing-value");
      expect(result.DATABASE_POOL).toBe("10");
    });

    it("should override existing keys by default", () => {
      const result = client.prepareEnvironment(mockDecrypted, { DATABASE_URL: "existing-value" });

      expect(result.DATABASE_URL).toBe("postgres://localhost/myapp");
    });

    it("should combine --only and --prefix", () => {
      const result = client.prepareEnvironment(
        mockDecrypted,
        {},
        {
          only: ["DATABASE_URL"],
          prefix: "MY_",
        },
      );

      expect(result.MY_DATABASE_URL).toBe("postgres://localhost/myapp");
      expect(result.MY_DATABASE_POOL).toBeUndefined();
    });

    it("should combine --prefix and --no-override", () => {
      const result = client.prepareEnvironment(
        mockDecrypted,
        { APP_DATABASE_URL: "existing" },
        { prefix: "APP_", noOverride: true },
      );

      expect(result.APP_DATABASE_URL).toBe("existing");
      expect(result.APP_DATABASE_POOL).toBe("10");
    });

    it("should handle empty decrypted file", () => {
      const empty: DecryptedFile = {
        values: {},
        metadata: { backend: "age", recipients: [], lastModified: new Date() },
      };

      const result = client.prepareEnvironment(empty, { PATH: "/usr/bin" });
      expect(result.PATH).toBe("/usr/bin");
      expect(Object.keys(result)).toHaveLength(1);
    });

    it("should skip undefined values from base environment", () => {
      const result = client.prepareEnvironment(mockDecrypted, {
        DEFINED: "yes",
        UNDEFINED: undefined,
      } as Record<string, string | undefined>);

      expect(result.DEFINED).toBe("yes");
      expect("UNDEFINED" in result).toBe(false);
    });
  });

  describe("formatExport", () => {
    it("should format values with export prefix", () => {
      const result = client.formatExport(mockDecrypted, "env", false);

      expect(result).toContain("export DATABASE_URL='postgres://localhost/myapp'");
      expect(result).toContain("export DATABASE_POOL='10'");
      expect(result).toContain("export API_KEY='sk-secret-123'");
    });

    it("should omit export keyword with noExport", () => {
      const result = client.formatExport(mockDecrypted, "env", true);

      expect(result).toContain("DATABASE_URL='postgres://localhost/myapp'");
      expect(result).not.toContain("export ");
    });

    it("should escape single quotes in values", () => {
      const withQuotes: DecryptedFile = {
        values: { GREETING: "it's a test" },
        metadata: { backend: "age", recipients: [], lastModified: new Date() },
      };

      const result = client.formatExport(withQuotes, "env", false);
      expect(result).toContain("export GREETING='it'\\''s a test'");
    });

    it("should handle special characters in values", () => {
      const withSpecial: DecryptedFile = {
        values: { URL: "postgres://user:p@ss$word/db?ssl=true&timeout=30" },
        metadata: { backend: "age", recipients: [], lastModified: new Date() },
      };

      const result = client.formatExport(withSpecial, "env", false);
      expect(result).toContain("export URL='postgres://user:p@ss$word/db?ssl=true&timeout=30'");
    });

    it("should throw for unsupported formats", () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.formatExport(mockDecrypted, "dotenv" as any, false);
      }).toThrow(/Unsupported export format/);
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.formatExport(mockDecrypted, "dotenv" as any, false);
      }).toThrow(/plaintext secrets to disk/);
    });

    it("should end with a trailing newline", () => {
      const result = client.formatExport(mockDecrypted, "env", false);
      expect(result.endsWith("\n")).toBe(true);
    });

    it("should handle empty values", () => {
      const empty: DecryptedFile = {
        values: { EMPTY: "" },
        metadata: { backend: "age", recipients: [], lastModified: new Date() },
      };

      const result = client.formatExport(empty, "env", false);
      expect(result).toContain("export EMPTY=''");
    });
  });
});
