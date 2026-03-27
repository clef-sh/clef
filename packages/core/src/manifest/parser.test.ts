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

    it("should reject namespace names with invalid characters", () => {
      const manifest = {
        ...validManifest(),
        namespaces: [{ name: "My.Namespace", description: "Invalid" }],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/Namespace name 'My.Namespace' is invalid/);
    });

    it("should reject namespace names starting with a digit", () => {
      const manifest = {
        ...validManifest(),
        namespaces: [{ name: "1database", description: "Starts with digit" }],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/Namespace name '1database' is invalid/);
    });

    it("should accept valid namespace names with hyphens and underscores", () => {
      const manifest = {
        ...validManifest(),
        namespaces: [
          { name: "my-database", description: "Valid hyphen" },
          { name: "auth_keys", description: "Valid underscore" },
        ],
      };
      expect(() => parser.validate(manifest)).not.toThrow();
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

    // Per-environment recipients tests
    it("should accept per-env recipients as string array", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            recipients: ["age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"],
          },
          { name: "dev", description: "Dev" },
        ],
      };
      const result = parser.validate(manifest);
      expect(result.environments[0].recipients).toEqual([
        "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p",
      ]);
      expect(result.environments[1].recipients).toBeUndefined();
    });

    it("should accept per-env recipients as object array", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "production",
            description: "Prod",
            recipients: [
              {
                key: "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p",
                label: "Alice",
              },
            ],
          },
        ],
      };
      const result = parser.validate(manifest);
      expect(result.environments[0].recipients).toEqual([
        {
          key: "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p",
          label: "Alice",
        },
      ]);
    });

    it("should accept empty recipients array (no-op)", () => {
      const manifest = {
        ...validManifest(),
        environments: [{ name: "dev", description: "Dev", recipients: [] }],
      };
      const result = parser.validate(manifest);
      expect(result.environments[0].recipients).toBeUndefined();
    });

    it("should reject non-array recipients field", () => {
      const manifest = {
        ...validManifest(),
        environments: [{ name: "dev", description: "Dev", recipients: "not-an-array" }],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/must be an array/);
    });

    it("should reject invalid age key in string recipient", () => {
      const manifest = {
        ...validManifest(),
        environments: [{ name: "dev", description: "Dev", recipients: ["not-a-valid-key"] }],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/recipient at index 0/);
    });

    it("should reject invalid age key in object recipient", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "dev",
            description: "Dev",
            recipients: [{ key: "not-valid", label: "Bad" }],
          },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/recipient at index 0/);
    });

    it("should reject recipient object without key field", () => {
      const manifest = {
        ...validManifest(),
        environments: [
          {
            name: "dev",
            description: "Dev",
            recipients: [{ label: "Missing key" }],
          },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/must have a 'key' string/);
    });

    it("should reject non-string/non-object recipient entry", () => {
      const manifest = {
        ...validManifest(),
        environments: [{ name: "dev", description: "Dev", recipients: [42] }],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/must be a string or object/);
    });

    it("should reject per-env recipients with non-age backend", () => {
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
            recipients: ["age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"],
          },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/only supported with the 'age' backend/);
    });

    it("should reject per-env recipients when global backend is non-age and no env override", () => {
      const manifest = {
        ...validManifest(),
        sops: { default_backend: "awskms", aws_kms_arn: "arn:aws:kms:us-east-1:123:key/abc" },
        environments: [
          {
            name: "production",
            description: "Prod",
            recipients: ["age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"],
          },
        ],
      };
      expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
      expect(() => parser.validate(manifest)).toThrow(/only supported with the 'age' backend/);
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

    describe("cloud section validation", () => {
      it("should accept a valid cloud section", () => {
        const manifest = {
          ...validManifest(),
          cloud: { integrationId: "int_abc123" },
        };
        const result = parser.validate(manifest);
        expect(result.cloud).toEqual({ integrationId: "int_abc123" });
      });

      it("should accept manifest without cloud section", () => {
        const result = parser.validate(validManifest());
        expect(result.cloud).toBeUndefined();
      });

      it("should reject cloud with missing integrationId", () => {
        const manifest = { ...validManifest(), cloud: {} };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/integrationId/);
      });

      it("should reject cloud with non-string integrationId", () => {
        const manifest = { ...validManifest(), cloud: { integrationId: 123 } };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/integrationId/);
      });

      it("should reject non-object cloud field", () => {
        const manifest = { ...validManifest(), cloud: "not-an-object" };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/must be an object/);
      });
    });

    describe("service_identities validation", () => {
      const testRecipient = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";

      it("should accept a valid service identity", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "api-gw",
              description: "API gateway",
              namespaces: ["database"],
              environments: {
                dev: { recipient: testRecipient },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        const result = parser.validate(manifest);
        expect(result.service_identities).toHaveLength(1);
        expect(result.service_identities![0].name).toBe("api-gw");
      });

      it("should reject service identity missing name", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              description: "No name",
              namespaces: ["database"],
              environments: {
                dev: { recipient: testRecipient },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/name/);
      });

      it("should reject service identity missing description", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "api-gw",
              namespaces: ["database"],
              environments: {
                dev: { recipient: testRecipient },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/description/);
      });

      it("should reject service identity with empty namespaces array", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "api-gw",
              description: "API gateway",
              namespaces: [],
              environments: {
                dev: { recipient: testRecipient },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/namespaces/);
      });

      it("should reject service identity referencing unknown namespace", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "api-gw",
              description: "API gateway",
              namespaces: ["nonexistent"],
              environments: {
                dev: { recipient: testRecipient },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/nonexistent/);
      });

      it("should reject service identity missing environments object", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "api-gw",
              description: "API gateway",
              namespaces: ["database"],
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/environments/);
      });

      it("should reject service identity missing an environment entry", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "api-gw",
              description: "API gateway",
              namespaces: ["database"],
              environments: {
                dev: { recipient: testRecipient },
                // staging and production missing
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/staging/);
      });

      it("should reject service identity with invalid recipient key", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "api-gw",
              description: "API gateway",
              namespaces: ["database"],
              environments: {
                dev: { recipient: "not-a-valid-key" },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/age public key/);
      });

      it("should reject duplicate service identity names", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "api-gw",
              description: "First",
              namespaces: ["database"],
              environments: {
                dev: { recipient: testRecipient },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
            {
              name: "api-gw",
              description: "Duplicate",
              namespaces: ["auth"],
              environments: {
                dev: { recipient: testRecipient },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/Duplicate.*api-gw/);
      });

      it("should reject non-array service_identities", () => {
        const manifest = {
          ...validManifest(),
          service_identities: "not-an-array",
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/must be an array/);
      });

      it("should accept a valid KMS service identity", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "kms-svc",
              description: "KMS service",
              namespaces: ["database"],
              environments: {
                dev: { kms: { provider: "aws", keyId: "arn:aws:kms:us-east-1:111:key/dev" } },
                staging: { kms: { provider: "aws", keyId: "arn:aws:kms:us-east-1:222:key/stg" } },
                production: {
                  kms: {
                    provider: "aws",
                    keyId: "arn:aws:kms:us-west-2:333:key/prd",
                    region: "us-west-2",
                  },
                },
              },
            },
          ],
        };
        const result = parser.validate(manifest);
        expect(result.service_identities).toHaveLength(1);
        expect(result.service_identities![0].environments.dev.kms).toEqual({
          provider: "aws",
          keyId: "arn:aws:kms:us-east-1:111:key/dev",
          region: undefined,
        });
        expect(result.service_identities![0].environments.production.kms?.region).toBe("us-west-2");
      });

      it("should reject both recipient and kms (mutual exclusion)", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "bad-svc",
              description: "Bad config",
              namespaces: ["database"],
              environments: {
                dev: { recipient: testRecipient, kms: { provider: "aws", keyId: "arn:..." } },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/mutually exclusive/);
      });

      it("should reject neither recipient nor kms", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "empty-svc",
              description: "Empty config",
              namespaces: ["database"],
              environments: {
                dev: {},
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/must have either/);
      });

      it("should reject invalid KMS provider", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "bad-provider",
              description: "Bad provider",
              namespaces: ["database"],
              environments: {
                dev: { kms: { provider: "oracle", keyId: "key-123" } },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/kms\.provider must be one of/);
      });

      it("should reject KMS config with missing keyId", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "no-keyid",
              description: "Missing keyId",
              namespaces: ["database"],
              environments: {
                dev: { kms: { provider: "aws" } },
                staging: { recipient: testRecipient },
                production: { recipient: testRecipient },
              },
            },
          ],
        };
        expect(() => parser.validate(manifest)).toThrow(ManifestValidationError);
        expect(() => parser.validate(manifest)).toThrow(/kms\.keyId must be a non-empty string/);
      });

      it("should allow mixed age and KMS environments", () => {
        const manifest = {
          ...validManifest(),
          service_identities: [
            {
              name: "mixed-svc",
              description: "Mixed environments",
              namespaces: ["database"],
              environments: {
                dev: { recipient: testRecipient },
                staging: { recipient: testRecipient },
                production: {
                  kms: { provider: "aws", keyId: "arn:aws:kms:us-west-2:333:key/prd" },
                },
              },
            },
          ],
        };
        const result = parser.validate(manifest);
        expect(result.service_identities![0].environments.dev.recipient).toBeTruthy();
        expect(result.service_identities![0].environments.production.kms).toBeTruthy();
      });
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
