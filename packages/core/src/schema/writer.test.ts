import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import writeFileAtomic from "write-file-atomic";
import { emptyTemplate, exampleTemplate, serializeSchema, writeSchema } from "./writer";
import { SchemaValidator } from "./validator";
import { NamespaceSchema } from "../types";

// The global mock for write-file-atomic is a no-op jest.fn; for these tests
// we want real disk writes to prove round-tripping through loadSchema works.
const mockWriteSync = writeFileAtomic.sync as jest.Mock;
beforeEach(() => {
  mockWriteSync.mockImplementation((file: string, contents: string | Buffer) => {
    fs.writeFileSync(file, contents);
  });
});
afterEach(() => {
  mockWriteSync.mockReset();
});

describe("schema writer", () => {
  describe("serializeSchema", () => {
    it("emits only declared fields in stable order", () => {
      const schema: NamespaceSchema = {
        keys: {
          API_KEY: {
            type: "string",
            required: true,
            pattern: "^sk_",
            description: "Stripe key",
          },
          FLAG: { type: "boolean", required: false },
        },
      };
      const yaml = serializeSchema(schema);
      // Key-level field ordering: type before required before pattern before description.
      const apiKeyBlock = yaml.slice(yaml.indexOf("API_KEY:"));
      expect(apiKeyBlock.indexOf("type:")).toBeLessThan(apiKeyBlock.indexOf("required:"));
      expect(apiKeyBlock.indexOf("required:")).toBeLessThan(apiKeyBlock.indexOf("pattern:"));
      expect(apiKeyBlock.indexOf("pattern:")).toBeLessThan(apiKeyBlock.indexOf("description:"));
    });

    it("omits optional fields when undefined", () => {
      const schema: NamespaceSchema = {
        keys: { BARE: { type: "string", required: false } },
      };
      const yaml = serializeSchema(schema);
      expect(yaml).not.toMatch(/pattern:/);
      expect(yaml).not.toMatch(/description:/);
    });

    it("round-trips through SchemaValidator.loadSchema", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-schema-writer-"));
      const file = path.join(tmpDir, "s.yaml");
      const schema: NamespaceSchema = {
        keys: {
          URL: { type: "string", required: true, pattern: "^https?://" },
          PORT: { type: "integer", required: true },
          SSL: { type: "boolean", required: false, description: "Use TLS" },
        },
      };
      fs.writeFileSync(file, serializeSchema(schema));

      const loaded = new SchemaValidator().loadSchema(file);
      expect(loaded).toEqual(schema);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("round-trips an empty schema", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-schema-writer-"));
      const file = path.join(tmpDir, "s.yaml");
      fs.writeFileSync(file, serializeSchema({ keys: {} }));

      const loaded = new SchemaValidator().loadSchema(file);
      expect(loaded).toEqual({ keys: {} });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("prepends a comment header when provided", () => {
      const yaml = serializeSchema({ keys: {} }, { header: "line one\n\nline three" });
      expect(yaml).toMatch(/^# line one\n#\n# line three\n\n/);
    });

    it("loads cleanly when a header is present", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-schema-writer-"));
      const file = path.join(tmpDir, "s.yaml");
      const schema: NamespaceSchema = {
        keys: { K: { type: "string", required: true } },
      };
      fs.writeFileSync(file, serializeSchema(schema, { header: "inferred on 2026-04-24" }));

      const loaded = new SchemaValidator().loadSchema(file);
      expect(loaded).toEqual(schema);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("writeSchema", () => {
    it("creates parent directories and writes atomically", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-schema-writer-"));
      const nested = path.join(tmpDir, "schemas", "nested", "auth.yaml");

      writeSchema(tmpDir, nested, { keys: { K: { type: "string", required: true } } });

      expect(fs.existsSync(nested)).toBe(true);
      const loaded = new SchemaValidator().loadSchema(nested);
      expect(loaded.keys.K).toEqual({ type: "string", required: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("overwrites an existing file", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-schema-writer-"));
      const file = path.join(tmpDir, "s.yaml");
      writeSchema(tmpDir, file, { keys: { A: { type: "string", required: true } } });
      writeSchema(tmpDir, file, { keys: { B: { type: "integer", required: false } } });

      const loaded = new SchemaValidator().loadSchema(file);
      expect(Object.keys(loaded.keys)).toEqual(["B"]);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("refuses to write outside the rootDir via traversal", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-schema-writer-"));
      const escapedAbs = path.join(tmpDir, "..", "outside.yaml");
      expect(() =>
        writeSchema(tmpDir, escapedAbs, { keys: { K: { type: "string", required: true } } }),
      ).toThrow(/outside the repository root/);
      expect(fs.existsSync(escapedAbs)).toBe(false);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("refuses to write outside the rootDir via an absolute redirection", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-schema-writer-"));
      // path.resolve(rootDir, absoluteOther) returns absoluteOther as-is —
      // exactly the case the sanitizer must catch.
      const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-schema-other-"));
      const target = path.join(otherDir, "stolen.yaml");
      expect(() =>
        writeSchema(tmpDir, target, { keys: { K: { type: "string", required: true } } }),
      ).toThrow(/outside the repository root/);
      expect(fs.existsSync(target)).toBe(false);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(otherDir, { recursive: true, force: true });
    });
  });

  describe("emptyTemplate", () => {
    it("produces a valid empty schema that loadSchema accepts", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-schema-writer-"));
      const file = path.join(tmpDir, "s.yaml");
      fs.writeFileSync(file, emptyTemplate("auth"));

      const loaded = new SchemaValidator().loadSchema(file);
      expect(loaded).toEqual({ keys: {} });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("mentions the namespace name in the header", () => {
      expect(emptyTemplate("payments")).toMatch(/namespace 'payments'/);
    });
  });

  describe("exampleTemplate", () => {
    it("parses cleanly and yields an empty schema (example is commented out)", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-schema-writer-"));
      const file = path.join(tmpDir, "s.yaml");
      fs.writeFileSync(file, exampleTemplate("auth"));

      const loaded = new SchemaValidator().loadSchema(file);
      expect(loaded).toEqual({ keys: {} });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("includes a commented example key for the user to uncomment", () => {
      const tmpl = exampleTemplate("auth");
      expect(tmpl).toMatch(/#\s+API_KEY:/);
      expect(tmpl).toMatch(/#\s+type: string/);
      expect(tmpl).toMatch(/#\s+pattern: \^sk_/);
    });
  });
});
