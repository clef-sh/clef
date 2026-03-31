import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { scaffoldSopsConfig } from "./sops-config";

jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

const manifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod", protected: true },
  ],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" as const },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFs.readFileSync.mockReturnValue(YAML.stringify(manifest));
  mockFs.existsSync.mockReturnValue(false);
  mockFs.writeFileSync.mockReturnValue(undefined);
});

describe("scaffoldSopsConfig", () => {
  it("generates creation rules for each namespace x environment cell", () => {
    scaffoldSopsConfig("/repo");

    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    const [writePath, content] = mockFs.writeFileSync.mock.calls[0];
    expect(writePath).toBe(path.join("/repo", ".sops.yaml"));

    const sopsConfig = YAML.parse(content as string) as { creation_rules: unknown[] };
    expect(sopsConfig.creation_rules).toHaveLength(2); // 1 namespace x 2 environments
  });

  it("sets age recipient from ageKeyFile argument", () => {
    mockFs.existsSync.mockImplementation((p) => String(p) === "/keys/age.txt");
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith("clef.yaml")) return YAML.stringify(manifest);
      if (String(p) === "/keys/age.txt") return "# public key: age1testpubkey123\nAGE-SECRET-KEY-1";
      return "";
    });

    scaffoldSopsConfig("/repo", "/keys/age.txt");

    const content = mockFs.writeFileSync.mock.calls[0][1] as string;
    const sopsConfig = YAML.parse(content) as {
      creation_rules: Array<{ age?: string }>;
    };
    expect(sopsConfig.creation_rules[0].age).toBe("age1testpubkey123");
  });

  it("extracts age public key from inline ageKey argument", () => {
    scaffoldSopsConfig("/repo", undefined, "# public key: age1inlinekey456\nAGE-SECRET-KEY-1X");

    const content = mockFs.writeFileSync.mock.calls[0][1] as string;
    const sopsConfig = YAML.parse(content) as {
      creation_rules: Array<{ age?: string }>;
    };
    expect(sopsConfig.creation_rules[0].age).toBe("age1inlinekey456");
  });

  it("falls back to CLEF_AGE_KEY_FILE env var", () => {
    const origEnv = process.env.CLEF_AGE_KEY_FILE;
    process.env.CLEF_AGE_KEY_FILE = "/env/key.txt";
    mockFs.existsSync.mockImplementation((p) => String(p) === "/env/key.txt");
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith("clef.yaml")) return YAML.stringify(manifest);
      if (String(p) === "/env/key.txt") return "# public key: age1envfilekey789\nAGE-SECRET-KEY-1";
      return "";
    });

    try {
      scaffoldSopsConfig("/repo");
    } finally {
      if (origEnv === undefined) delete process.env.CLEF_AGE_KEY_FILE;
      else process.env.CLEF_AGE_KEY_FILE = origEnv;
    }

    const content = mockFs.writeFileSync.mock.calls[0][1] as string;
    const sopsConfig = YAML.parse(content) as {
      creation_rules: Array<{ age?: string }>;
    };
    expect(sopsConfig.creation_rules[0].age).toBe("age1envfilekey789");
  });

  it("falls back to CLEF_AGE_KEY env var", () => {
    const origEnv = process.env.CLEF_AGE_KEY;
    process.env.CLEF_AGE_KEY = "# public key: age1envkey000\nAGE-SECRET-KEY-1Y";

    try {
      scaffoldSopsConfig("/repo");
    } finally {
      if (origEnv === undefined) delete process.env.CLEF_AGE_KEY;
      else process.env.CLEF_AGE_KEY = origEnv;
    }

    const content = mockFs.writeFileSync.mock.calls[0][1] as string;
    const sopsConfig = YAML.parse(content) as {
      creation_rules: Array<{ age?: string }>;
    };
    expect(sopsConfig.creation_rules[0].age).toBe("age1envkey000");
  });

  it("falls back to .clef/config.yaml for age key path", () => {
    const clefConfigPath = path.join("/repo", ".clef", "config.yaml");
    mockFs.existsSync.mockImplementation(
      (p) => String(p) === clefConfigPath || String(p) === "/home/user/.age/key.txt",
    );
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith("clef.yaml")) return YAML.stringify(manifest);
      if (String(p) === clefConfigPath)
        return YAML.stringify({ age_key_file: "/home/user/.age/key.txt" });
      if (String(p) === "/home/user/.age/key.txt")
        return "# public key: age1configkey111\nAGE-SECRET-KEY-1Z";
      return "";
    });

    scaffoldSopsConfig("/repo");

    const content = mockFs.writeFileSync.mock.calls[0][1] as string;
    const sopsConfig = YAML.parse(content) as {
      creation_rules: Array<{ age?: string }>;
    };
    expect(sopsConfig.creation_rules[0].age).toBe("age1configkey111");
  });

  it("generates AWS KMS rules for awskms backend", () => {
    const kmsManifest = {
      ...manifest,
      sops: { default_backend: "awskms" as const, aws_kms_arn: "arn:aws:kms:us-east-1:123:key/x" },
    };
    mockFs.readFileSync.mockReturnValue(YAML.stringify(kmsManifest));

    scaffoldSopsConfig("/repo");

    const content = mockFs.writeFileSync.mock.calls[0][1] as string;
    const sopsConfig = YAML.parse(content) as {
      creation_rules: Array<{ kms?: string }>;
    };
    expect(sopsConfig.creation_rules[0].kms).toBe("arn:aws:kms:us-east-1:123:key/x");
  });

  it("generates GCP KMS rules for gcpkms backend", () => {
    const gcpManifest = {
      ...manifest,
      sops: {
        default_backend: "gcpkms" as const,
        gcp_kms_resource_id: "projects/p/locations/l/keyRings/k/cryptoKeys/c",
      },
    };
    mockFs.readFileSync.mockReturnValue(YAML.stringify(gcpManifest));

    scaffoldSopsConfig("/repo");

    const content = mockFs.writeFileSync.mock.calls[0][1] as string;
    const sopsConfig = YAML.parse(content) as {
      creation_rules: Array<{ gcp_kms?: string }>;
    };
    expect(sopsConfig.creation_rules[0].gcp_kms).toBe(
      "projects/p/locations/l/keyRings/k/cryptoKeys/c",
    );
  });

  it("generates Azure Key Vault rules for azurekv backend", () => {
    const azureManifest = {
      ...manifest,
      sops: {
        default_backend: "azurekv" as const,
        azure_kv_url: "https://vault.vault.azure.net/keys/k/v",
      },
    };
    mockFs.readFileSync.mockReturnValue(YAML.stringify(azureManifest));

    scaffoldSopsConfig("/repo");

    const content = mockFs.writeFileSync.mock.calls[0][1] as string;
    const sopsConfig = YAML.parse(content) as {
      creation_rules: Array<{ azure_keyvault?: string }>;
    };
    expect(sopsConfig.creation_rules[0].azure_keyvault).toBe(
      "https://vault.vault.azure.net/keys/k/v",
    );
  });

  it("generates PGP rules for pgp backend", () => {
    const pgpManifest = {
      ...manifest,
      sops: { default_backend: "pgp" as const, pgp_fingerprint: "ABCDEF1234567890" },
    };
    mockFs.readFileSync.mockReturnValue(YAML.stringify(pgpManifest));

    scaffoldSopsConfig("/repo");

    const content = mockFs.writeFileSync.mock.calls[0][1] as string;
    const sopsConfig = YAML.parse(content) as {
      creation_rules: Array<{ pgp?: string }>;
    };
    expect(sopsConfig.creation_rules[0].pgp).toBe("ABCDEF1234567890");
  });

  it("uses per-environment recipients when available", () => {
    const recipientManifest = {
      ...manifest,
      environments: [
        {
          name: "dev",
          description: "Dev",
          recipients: ["age1qqnqmjgya3nglm7wt2frgvae9xnn0qsrjqvksmef3hxux9h5gkqcmypn0"],
        },
        { name: "production", description: "Prod", protected: true },
      ],
    };
    mockFs.readFileSync.mockReturnValue(YAML.stringify(recipientManifest));

    scaffoldSopsConfig("/repo", undefined, "# public key: age1fallback\nAGE-SECRET-KEY-1");

    const content = mockFs.writeFileSync.mock.calls[0][1] as string;
    const sopsConfig = YAML.parse(content) as {
      creation_rules: Array<{ age?: string; path_regex: string }>;
    };
    const devRule = sopsConfig.creation_rules.find((r) => r.path_regex.includes("dev"));
    const prodRule = sopsConfig.creation_rules.find((r) => r.path_regex.includes("production"));
    expect(devRule?.age).toBe("age1qqnqmjgya3nglm7wt2frgvae9xnn0qsrjqvksmef3hxux9h5gkqcmypn0");
    expect(prodRule?.age).toBe("age1fallback");
  });

  it("skips age key resolution for non-age backends", () => {
    const kmsManifest = {
      ...manifest,
      sops: { default_backend: "awskms" as const, aws_kms_arn: "arn:..." },
    };
    mockFs.readFileSync.mockReturnValue(YAML.stringify(kmsManifest));

    scaffoldSopsConfig("/repo", "/nonexistent/key.txt");

    // Should not try to read the age key file for a non-age backend
    const readCalls = mockFs.readFileSync.mock.calls.map((c) => String(c[0]));
    expect(readCalls.filter((p) => p.includes("nonexistent"))).toHaveLength(0);
  });
});
