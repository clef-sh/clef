import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { validateBroker, formatResults } from "./validate";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clef-broker-validate-"));
}

function writeManifest(dir: string, overrides?: Record<string, unknown>): void {
  const manifest = {
    name: "test-broker",
    version: "1.0.0",
    description: "Test broker",
    author: "test",
    license: "MIT",
    provider: "aws",
    tier: 1,
    inputs: [{ name: "DB_HOST", description: "Database host", secret: false }],
    output: { identity: "test-svc", ttl: 900, keys: ["TOKEN"] },
    ...overrides,
  };

  // Simple YAML serialization for flat/shallow objects
  const lines: string[] = [];
  for (const [key, value] of Object.entries(manifest)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          const entries = Object.entries(item);
          lines.push(`  - ${entries.map(([k, v]) => `${k}: ${v}`).join("\n    ")}`);
        } else {
          lines.push(`  - ${item}`);
        }
      }
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value)) {
        if (Array.isArray(v)) {
          lines.push(`  ${k}: [${v.join(", ")}]`);
        } else {
          lines.push(`  ${k}: ${v}`);
        }
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  fs.writeFileSync(path.join(dir, "broker.yaml"), lines.join("\n"));
}

function writeHandler(dir: string, content?: string): void {
  fs.writeFileSync(
    path.join(dir, "handler.ts"),
    content ??
      `import type { BrokerHandler } from "@clef-sh/broker";
export const handler: BrokerHandler = {
  create: async (config) => ({ data: { TOKEN: "val" }, ttl: 900 }),
};`,
  );
}

function writeReadme(dir: string, content?: string): void {
  fs.writeFileSync(
    path.join(dir, "README.md"),
    content ??
      `# test-broker

## Description
A test broker.

## Prerequisites
None.

## Configuration
Set DB_HOST.

## Deploy
Deploy with SAM.`,
  );
}

function scaffold(dir: string): void {
  writeManifest(dir);
  writeHandler(dir);
  writeReadme(dir);
}

describe("validateBroker", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("passes for a valid broker directory", () => {
    scaffold(dir);
    const result = validateBroker(dir);
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails when broker.yaml is missing", () => {
    writeHandler(dir);
    writeReadme(dir);

    const result = validateBroker(dir);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "broker.yaml exists")?.passed).toBe(false);
  });

  it("fails when broker.yaml is invalid YAML", () => {
    fs.writeFileSync(path.join(dir, "broker.yaml"), ": : : invalid");
    writeHandler(dir);
    writeReadme(dir);

    const result = validateBroker(dir);
    expect(result.passed).toBe(false);
  });

  it("fails when required manifest fields are missing", () => {
    writeManifest(dir, { name: undefined, version: undefined } as unknown as Record<
      string,
      unknown
    >);
    writeHandler(dir);
    writeReadme(dir);

    // Rewrite manifest without name and version
    fs.writeFileSync(
      path.join(dir, "broker.yaml"),
      `description: Test\nauthor: test\nlicense: MIT\nprovider: aws\ntier: 1\ninputs: []`,
    );

    const result = validateBroker(dir);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "manifest.name is present")?.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "manifest.version is present")?.passed).toBe(false);
  });

  it("fails for invalid provider", () => {
    writeManifest(dir, { provider: "oracle" });
    writeHandler(dir);
    writeReadme(dir);

    const result = validateBroker(dir);
    const check = result.checks.find((c) => c.name === "manifest.provider is valid");
    expect(check?.passed).toBe(false);
    expect(check?.message).toContain("oracle");
  });

  it("fails for invalid tier", () => {
    writeManifest(dir, { tier: 5 });
    writeHandler(dir);
    writeReadme(dir);

    const result = validateBroker(dir);
    const check = result.checks.find((c) => c.name === "manifest.tier is valid");
    expect(check?.passed).toBe(false);
  });

  it("fails for non-semver version", () => {
    writeManifest(dir, { version: "latest" });
    writeHandler(dir);
    writeReadme(dir);

    const result = validateBroker(dir);
    const check = result.checks.find((c) => c.name === "manifest.version is semver-like");
    expect(check?.passed).toBe(false);
  });

  it("fails for invalid name format", () => {
    writeManifest(dir, { name: "My_Broker" });
    writeHandler(dir);
    writeReadme(dir);

    const result = validateBroker(dir);
    const check = result.checks.find((c) => c.name === "manifest.name is lowercase with hyphens");
    expect(check?.passed).toBe(false);
  });

  it("fails when inputs entries are missing name or description", () => {
    writeManifest(dir, { inputs: [{ name: "HOST" }] });
    writeHandler(dir);
    writeReadme(dir);

    // Rewrite with input missing description
    const raw = fs.readFileSync(path.join(dir, "broker.yaml"), "utf-8");
    fs.writeFileSync(path.join(dir, "broker.yaml"), raw.replace("description: Database host", ""));

    const result = validateBroker(dir);
    const check = result.checks.find(
      (c) => c.name === "manifest.inputs entries have name and description",
    );
    expect(check?.passed).toBe(false);
  });

  it("fails when handler.ts is missing", () => {
    writeManifest(dir);
    writeReadme(dir);

    const result = validateBroker(dir);
    expect(result.checks.find((c) => c.name === "handler file exists")?.passed).toBe(false);
  });

  it("fails when handler does not contain create", () => {
    writeManifest(dir);
    writeReadme(dir);
    writeHandler(dir, "export const handler = { fetch: async () => ({}) };");

    const result = validateBroker(dir);
    const check = result.checks.find((c) => c.name === "handler exports create function");
    expect(check?.passed).toBe(false);
  });

  it("accepts handler.js as an alternative to handler.ts", () => {
    writeManifest(dir);
    writeReadme(dir);
    fs.writeFileSync(
      path.join(dir, "handler.js"),
      "exports.handler = { create: async () => ({ data: {}, ttl: 60 }) };",
    );

    const result = validateBroker(dir);
    expect(result.checks.find((c) => c.name === "handler file exists")?.passed).toBe(true);
    expect(result.checks.find((c) => c.name === "handler exports create function")?.passed).toBe(
      true,
    );
  });

  it("fails when README.md is missing", () => {
    writeManifest(dir);
    writeHandler(dir);

    const result = validateBroker(dir);
    expect(result.checks.find((c) => c.name === "README.md exists")?.passed).toBe(false);
  });

  it("fails when README.md is missing required sections", () => {
    writeManifest(dir);
    writeHandler(dir);
    writeReadme(dir, "# test-broker\n\nJust a broker.\n");

    const result = validateBroker(dir);
    const check = result.checks.find((c) => c.name === "README.md has required sections");
    expect(check?.passed).toBe(false);
    expect(check?.message).toContain("description");
  });

  it("reports all failures, not just the first one", () => {
    // Empty directory — everything should fail
    const result = validateBroker(dir);
    expect(result.passed).toBe(false);

    const failed = result.checks.filter((c) => !c.passed);
    expect(failed.length).toBeGreaterThan(1);
  });
});

describe("formatResults", () => {
  it("formats passing results", () => {
    const output = formatResults({
      passed: true,
      checks: [
        { name: "broker.yaml exists", passed: true, message: "OK" },
        { name: "handler file exists", passed: true, message: "OK" },
      ],
    });
    expect(output).toContain("PASS");
    expect(output).toContain("2/2 checks passed");
  });

  it("formats failing results with messages", () => {
    const output = formatResults({
      passed: false,
      checks: [
        { name: "broker.yaml exists", passed: true, message: "OK" },
        { name: "handler file exists", passed: false, message: "handler.ts not found" },
      ],
    });
    expect(output).toContain("FAIL");
    expect(output).toContain("handler.ts not found");
    expect(output).toContain("1 failed");
  });
});
