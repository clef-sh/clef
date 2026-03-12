import * as fs from "fs";
import * as YAML from "yaml";
import { ManifestParser } from "./parser";
import { ManifestValidationError } from "../types";

jest.mock("fs");

const mockFs = fs as jest.Mocked<typeof fs>;

function validManifest() {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "Local development" },
      { name: "staging", description: "Pre-production" },
      { name: "production", description: "Live system", protected: true },
    ],
    namespaces: [
      { name: "database", description: "Database config", schema: "schemas/database.yaml" },
      { name: "auth", description: "Auth secrets" },
    ],
    sops: {
      default_backend: "age",
    },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };
}

describe("ManifestParser", () => {
  let parser: ManifestParser;

  beforeEach(() => {
    parser = new ManifestParser();
    jest.clearAllMocks();
  });

  describe("parse", () => {
    it("should parse a valid manifest file", () => {
      const manifest = validManifest();
      mockFs.readFileSync.mockReturnValue(YAML.stringify(manifest));

      const result = parser.parse("/repo/clef.yaml");

      expect(result.version).toBe(1);
      expect(result.environments).toHaveLength(3);
      expect(result.namespaces).toHaveLength(2);
      expect(result.sops.default_backend).toBe("age");
      expect(result.file_pattern).toBe("{namespace}/{environment}.enc.yaml");
    });

    it("should throw when file does not exist", () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(() => parser.parse("/repo/missing.yaml")).toThrow(ManifestValidationError);
      expect(() => parser.parse("/repo/missing.yaml")).toThrow(/Could not read manifest/);
    });

    it("should throw on invalid YAML", () => {
      mockFs.readFileSync.mockReturnValue("{{invalid yaml");

      expect(() => parser.parse("/repo/clef.yaml")).toThrow(ManifestValidationError);
      expect(() => parser.parse("/repo/clef.yaml")).toThrow(/invalid YAML/);
    });
  });

  describe("validate", () => {
    it("should validate a correct manifest object", () => {
      const result = parser.validate(validManifest());

      expect(result.version).toBe(1);
      expect(result.environments[2].protected).toBe(true);
      expect(result.namespaces[0].schema).toBe("schemas/database.yaml");
    });

    it("should reject null input", () => {
      expect(() => parser.validate(null)).toThrow(ManifestValidationError);
      expect(() => parser.validate(null)).toThrow(/YAML object/);
    });

    it("should reject non-object input", () => {
      expect(() => parser.validate("string")).toThrow(ManifestValidationError);
    });

    it("should reject unknown top-level keys", () => {
      const manifest = { ...validManifest(), unknown_field: true };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/Unknown top-level key/);
    });

    it("should reject missing version", () => {
      const { version: _version, ...rest } = validManifest();
      expect(() => parser.validate(rest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(rest)).toThrow(/Missing required field 'version'/);
    });

    it("should reject invalid version number", () => {
      expect(() => parser.validate({ ...validManifest(), version: 2 })).toThrow(
        ManifestValidationError,
      );
      expect(() => parser.validate({ ...validManifest(), version: 2 })).toThrow(/must be 1/);
    });

    it("should reject missing environments", () => {
      const { environments: _environments, ...rest } = validManifest();
      expect(() => parser.validate(rest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(rest)).toThrow(/Missing required field 'environments'/);
    });

    it("should reject empty environments array", () => {
      expect(() => parser.validate({ ...validManifest(), environments: [] })).toThrow(
        ManifestValidationError,
      );
      expect(() => parser.validate({ ...validManifest(), environments: [] })).toThrow(/non-empty/);
    });

    it("should reject environment without name", () => {
      const manifest = {
        ...validManifest(),
        environments: [{ description: "No name" }],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/missing a 'name'/);
    });

    it("should reject invalid environment name", () => {
      const manifest = {
        ...validManifest(),
        environments: [{ name: "INVALID!", description: "Bad name" }],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/invalid/);
    });

    it("should reject environment without description", () => {
      const manifest = {
        ...validManifest(),
        environments: [{ name: "dev" }],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/missing a 'description'/);
    });

    it("should reject missing namespaces", () => {
      const { namespaces: _namespaces, ...rest } = validManifest();
      expect(() => parser.validate(rest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(rest)).toThrow(/Missing required field 'namespaces'/);
    });

    it("should reject empty namespaces array", () => {
      expect(() => parser.validate({ ...validManifest(), namespaces: [] })).toThrow(
        ManifestValidationError,
      );
    });

    it("should reject namespace without name", () => {
      const manifest = {
        ...validManifest(),
        namespaces: [{ description: "No name" }],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
    });

    it("should reject namespace without description", () => {
      const manifest = {
        ...validManifest(),
        namespaces: [{ name: "db" }],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
    });

    it("should reject non-object environment entries", () => {
      const manifest = {
        ...validManifest(),
        environments: ["just-a-string"],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/must be an object/);
    });

    it("should reject non-object namespace entries", () => {
      const manifest = {
        ...validManifest(),
        namespaces: [42],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
    });

    it("should reject missing sops config", () => {
      const { sops: _sops, ...rest } = validManifest();
      expect(() => parser.validate(rest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(rest)).toThrow(/Missing required field 'sops'/);
    });

    it("should reject sops config without default_backend", () => {
      const manifest = { ...validManifest(), sops: {} };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/default_backend/);
    });

    it("should reject invalid sops backend", () => {
      const manifest = { ...validManifest(), sops: { default_backend: "invalid" } };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/Invalid sops.default_backend/);
    });

    it("should reject missing file_pattern", () => {
      const { file_pattern: _file_pattern, ...rest } = validManifest();
      expect(() => parser.validate(rest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(rest)).toThrow(/Missing required field 'file_pattern'/);
    });

    it("should reject file_pattern missing {namespace}", () => {
      const manifest = {
        ...validManifest(),
        file_pattern: "{environment}.enc.yaml",
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/{namespace}/);
    });

    it("should reject file_pattern missing {environment}", () => {
      const manifest = {
        ...validManifest(),
        file_pattern: "{namespace}/secrets.enc.yaml",
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/{environment}/);
    });

    it("should parse sops config with all optional fields", () => {
      const manifest = {
        ...validManifest(),
        sops: {
          default_backend: "awskms",
          aws_kms_arn: "arn:aws:kms:us-east-1:123:key/abc",
          gcp_kms_resource_id: "projects/test/locations/global/keyRings/test/cryptoKeys/key1",
          pgp_fingerprint: "85D77543B3D624B63CEA9E6DBC17301B491B3F21",
        },
      };
      const result = parser.validate(manifest);
      expect(result.sops.aws_kms_arn).toBe("arn:aws:kms:us-east-1:123:key/abc");
      expect(result.sops.gcp_kms_resource_id).toContain("projects/test");
      expect(result.sops.pgp_fingerprint).toBe("85D77543B3D624B63CEA9E6DBC17301B491B3F21");
    });

    it("should accept namespaces with owners", () => {
      const manifest = validManifest();
      manifest.namespaces.push({
        name: "payments",
        description: "Payment secrets",
        owners: ["payments-team"],
      } as (typeof manifest.namespaces)[0]);

      const result = parser.validate(manifest);
      const payments = result.namespaces.find((n) => n.name === "payments");
      expect(payments?.owners).toEqual(["payments-team"]);
    });

    it("should accept all valid backend types", () => {
      for (const backend of ["age", "awskms", "gcpkms", "pgp"]) {
        const manifest = {
          ...validManifest(),
          sops: { default_backend: backend },
        };
        const result = parser.validate(manifest);
        expect(result.sops.default_backend).toBe(backend);
      }
    });

    it("should reject non-object sops field", () => {
      const manifest = { ...validManifest(), sops: "age" };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/must be an object/);
    });

    // Per-environment sops override tests
    it("should accept per-env sops override with awskms backend", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: {
              backend: "awskms",
              aws_kms_arn: "arn:aws:kms:us-east-1:123:key/abc",
            },
          },
          { name: "dev", description: "Dev" },
        ],
      };
      const result = parser.validate(manifest);
      expect(result.environments[0].sops).toEqual({
        backend: "awskms",
        aws_kms_arn: "arn:aws:kms:us-east-1:123:key/abc",
      });
      expect(result.environments[1].sops).toBeUndefined();
    });

    it("should accept per-env sops override with gcpkms backend", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: {
              backend: "gcpkms",
              gcp_kms_resource_id: "projects/test/locations/global/keyRings/test/cryptoKeys/key1",
            },
          },
        ],
      };
      const result = parser.validate(manifest);
      expect(result.environments[0].sops?.backend).toBe("gcpkms");
      expect(result.environments[0].sops?.gcp_kms_resource_id).toContain("projects/test");
    });

    it("should accept per-env sops override with pgp backend", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: {
              backend: "pgp",
              pgp_fingerprint: "85D77543B3D624B63CEA9E6DBC17301B491B3F21",
            },
          },
        ],
      };
      const result = parser.validate(manifest);
      expect(result.environments[0].sops?.backend).toBe("pgp");
      expect(result.environments[0].sops?.pgp_fingerprint).toBe(
        "85D77543B3D624B63CEA9E6DBC17301B491B3F21",
      );
    });

    it("should accept per-env sops override with age backend (no extra fields)", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "dev",
            description: "Dev",
            sops: { backend: "age" },
          },
        ],
      };
      const result = parser.validate(manifest);
      expect(result.environments[0].sops).toEqual({ backend: "age" });
    });

    it("should reject per-env awskms backend missing aws_kms_arn", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: { backend: "awskms" },
          },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/missing 'aws_kms_arn'/);
    });

    it("should reject per-env gcpkms backend missing gcp_kms_resource_id", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: { backend: "gcpkms" },
          },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/missing 'gcp_kms_resource_id'/);
    });

    it("should reject per-env pgp backend missing pgp_fingerprint", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: { backend: "pgp" },
          },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/missing 'pgp_fingerprint'/);
    });

    it("should reject per-env sops with unknown backend value", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: { backend: "invalid" },
          },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/invalid sops backend/);
    });

    it("should reject per-env sops with missing backend field", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: { aws_kms_arn: "arn:aws:kms:us-east-1:123:key/abc" },
          },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/missing 'backend'/);
    });

    it("should reject duplicate environment names", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          { name: "dev", description: "Dev 1" },
          { name: "staging", description: "Staging" },
          { name: "dev", description: "Dev 2" },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/Duplicate environment name 'dev'/);
    });

    it("should reject duplicate namespace names", () => {
      const manifest = {
        ...validManifest(),
        namespaces: [
          { name: "database", description: "DB 1" },
          { name: "auth", description: "Auth" },
          { name: "database", description: "DB 2" },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/Duplicate namespace name 'database'/);
    });

    it("should reject non-object per-env sops field", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            sops: "age",
          },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/invalid 'sops' field/);
    });
  });

  describe("watch", () => {
    it("should call onChange when file changes", () => {
      const manifest = validManifest();
      mockFs.readFileSync.mockReturnValue(YAML.stringify(manifest));

      let watchCallback: (() => void) | undefined;
      const mockWatcher = { close: jest.fn() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mocking fs.watch overloads
      (mockFs.watch as any).mockImplementation((_path: any, cb: any) => {
        watchCallback = cb as () => void;
        return mockWatcher as unknown as fs.FSWatcher;
      });

      const onChange = jest.fn();
      const unsubscribe = parser.watch("/repo/clef.yaml", onChange);

      expect(watchCallback).toBeDefined();
      watchCallback!();
      expect(onChange).toHaveBeenCalledTimes(1);

      unsubscribe();
      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it("should not call onChange when file parse fails during watch", () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      let watchCallback: (() => void) | undefined;
      const mockWatcher = { close: jest.fn() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mocking fs.watch overloads
      (mockFs.watch as any).mockImplementation((_path: any, cb: any) => {
        watchCallback = cb as () => void;
        return mockWatcher as unknown as fs.FSWatcher;
      });

      const onChange = jest.fn();
      parser.watch("/repo/clef.yaml", onChange);

      watchCallback!();
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
