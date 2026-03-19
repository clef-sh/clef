import { ClefManifest, resolveRecipientsForEnvironment } from "./index";

const validKey1 = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";
const validKey2 = "age1deadgyu9nk64as3xhfmz05u94lef3nym6hvqntrrmyzpq28pjxdqs5gfng";

function makeManifest(envRecipients?: (string | { key: string; label?: string })[]): ClefManifest {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "Dev" },
      {
        name: "production",
        description: "Prod",
        ...(envRecipients ? { recipients: envRecipients } : {}),
      },
    ],
    namespaces: [{ name: "database", description: "DB" }],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };
}

describe("resolveRecipientsForEnvironment", () => {
  it("returns per-env recipients when defined", () => {
    const manifest = makeManifest([validKey1, { key: validKey2, label: "Bob" }]);
    const result = resolveRecipientsForEnvironment(manifest, "production");
    expect(result).toEqual([validKey1, { key: validKey2, label: "Bob" }]);
  });

  it("returns undefined when environment has no recipients", () => {
    const manifest = makeManifest();
    const result = resolveRecipientsForEnvironment(manifest, "production");
    expect(result).toBeUndefined();
  });

  it("returns undefined when environment has empty recipients array", () => {
    const manifest = makeManifest([]);
    const result = resolveRecipientsForEnvironment(manifest, "production");
    expect(result).toBeUndefined();
  });

  it("returns undefined for environment without recipients field", () => {
    const manifest = makeManifest();
    const result = resolveRecipientsForEnvironment(manifest, "dev");
    expect(result).toBeUndefined();
  });

  it("returns undefined for non-existent environment", () => {
    const manifest = makeManifest();
    const result = resolveRecipientsForEnvironment(manifest, "nonexistent");
    expect(result).toBeUndefined();
  });
});
