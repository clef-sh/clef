import * as fs from "fs";
import * as YAML from "yaml";
import writeFileAtomic from "write-file-atomic";
import { StructureManager } from "./manager";
import { ClefManifest } from "../types";
import { MatrixManager } from "../matrix/manager";
import { TransactionManager } from "../tx";

jest.mock("fs");
// write-file-atomic is auto-mocked via core's jest.config moduleNameMapper.

const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockRenameSync = fs.renameSync as jest.MockedFunction<typeof fs.renameSync>;
const mockMkdirSync = fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>;
const mockWriteFileAtomicSync = writeFileAtomic.sync as jest.Mock;

/** Stub TransactionManager that just runs the mutate callback inline. */
function makeStubTx(): TransactionManager {
  return {
    run: jest
      .fn()
      .mockImplementation(
        async (_repoRoot: string, opts: { mutate: () => Promise<void>; paths: string[] }) => {
          await opts.mutate();
          return { sha: null, paths: opts.paths, startedDirty: false };
        },
      ),
  } as unknown as TransactionManager;
}

const repoRoot = "/repo";

function baseManifest(overrides?: Partial<ClefManifest>): ClefManifest {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "Development" },
      { name: "production", description: "Production", protected: true },
    ],
    namespaces: [
      { name: "payments", description: "Payment secrets" },
      { name: "auth", description: "Auth secrets" },
    ],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
    ...overrides,
  };
}

function manifestWithSi(): ClefManifest {
  return baseManifest({
    service_identities: [
      {
        name: "web-app",
        description: "Web app",
        namespaces: ["payments", "auth"],
        environments: {
          dev: { recipient: "age1dev..." },
          production: { recipient: "age1prod..." },
        },
      },
    ],
  });
}

function setupFs(manifest: ClefManifest, existingCells: string[] = []): void {
  const yaml = YAML.stringify(manifest);
  mockReadFileSync.mockImplementation((p) => {
    const ps = String(p);
    if (ps.endsWith("clef.yaml")) return yaml;
    return "";
  });
  mockExistsSync.mockImplementation((p) => {
    const ps = String(p);
    if (ps.endsWith("clef.yaml")) return true;
    return existingCells.includes(ps);
  });
}

describe("StructureManager", () => {
  let matrixManager: MatrixManager;
  let manager: StructureManager;

  beforeEach(() => {
    jest.clearAllMocks();
    matrixManager = new MatrixManager();
    manager = new StructureManager(matrixManager, makeStubTx());
  });

  describe("editNamespace", () => {
    describe("manifest-only edits", () => {
      it("updates the description", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await manager.editNamespace("payments", { description: "New desc" }, manifest, repoRoot);

        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        expect(writeCall).toBeDefined();
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        const ns = written.namespaces.find((n) => n.name === "payments");
        expect(ns?.description).toBe("New desc");
        // No file renames happened
        expect(mockRenameSync).not.toHaveBeenCalled();
      });

      it("sets a schema path", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await manager.editNamespace(
          "payments",
          { schema: "schemas/payments.yaml" },
          manifest,
          repoRoot,
        );

        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        const ns = written.namespaces.find((n) => n.name === "payments");
        expect(ns?.schema).toBe("schemas/payments.yaml");
      });

      it("clears a schema path when given an empty string", async () => {
        const manifest = baseManifest({
          namespaces: [
            { name: "payments", description: "Payments", schema: "schemas/payments.yaml" },
          ],
        });
        setupFs(manifest);

        await manager.editNamespace("payments", { schema: "" }, manifest, repoRoot);

        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        const ns = written.namespaces.find((n) => n.name === "payments");
        expect(ns?.schema).toBeUndefined();
      });

      it("throws on unknown namespace", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await expect(
          manager.editNamespace("nonexistent", { description: "x" }, manifest, repoRoot),
        ).rejects.toThrow("Namespace 'nonexistent' not found");
      });
    });

    describe("rename", () => {
      it("renames cell files and updates the manifest", async () => {
        const manifest = baseManifest();
        // Both payments cells exist
        setupFs(manifest, ["/repo/payments/dev.enc.yaml", "/repo/payments/production.enc.yaml"]);

        await manager.editNamespace("payments", { rename: "billing" }, manifest, repoRoot);

        // Both files renamed
        expect(mockRenameSync).toHaveBeenCalledWith(
          "/repo/payments/dev.enc.yaml",
          "/repo/billing/dev.enc.yaml",
        );
        expect(mockRenameSync).toHaveBeenCalledWith(
          "/repo/payments/production.enc.yaml",
          "/repo/billing/production.enc.yaml",
        );

        // Manifest renamed
        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        expect(written.namespaces.find((n) => n.name === "billing")).toBeDefined();
        expect(written.namespaces.find((n) => n.name === "payments")).toBeUndefined();
      });

      it("creates the target directory if it does not exist", async () => {
        const manifest = baseManifest();
        // Source cells exist; target dir does not
        setupFs(manifest, ["/repo/payments/dev.enc.yaml"]);

        await manager.editNamespace("payments", { rename: "billing" }, manifest, repoRoot);

        expect(mockMkdirSync).toHaveBeenCalledWith("/repo/billing", { recursive: true });
      });

      it("also renames sibling .clef-meta.yaml files when present", async () => {
        const manifest = baseManifest();
        setupFs(manifest, [
          "/repo/payments/dev.enc.yaml",
          "/repo/payments/dev.clef-meta.yaml",
          "/repo/payments/production.enc.yaml",
        ]);

        await manager.editNamespace("payments", { rename: "billing" }, manifest, repoRoot);

        expect(mockRenameSync).toHaveBeenCalledWith(
          "/repo/payments/dev.clef-meta.yaml",
          "/repo/billing/dev.clef-meta.yaml",
        );
        // production has no meta sibling — not renamed
        expect(mockRenameSync).not.toHaveBeenCalledWith(
          "/repo/payments/production.clef-meta.yaml",
          expect.anything(),
        );
      });

      it("cascades the rename through service identity namespaces arrays", async () => {
        const manifest = manifestWithSi();
        setupFs(manifest, ["/repo/payments/dev.enc.yaml", "/repo/payments/production.enc.yaml"]);

        await manager.editNamespace("payments", { rename: "billing" }, manifest, repoRoot);

        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        const si = written.service_identities!.find((s) => s.name === "web-app")!;
        expect(si.namespaces).toEqual(["billing", "auth"]);
      });

      it("refuses if the target name already exists", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await expect(
          manager.editNamespace("payments", { rename: "auth" }, manifest, repoRoot),
        ).rejects.toThrow("Namespace 'auth' already exists");
      });

      it("refuses invalid identifier", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await expect(
          manager.editNamespace("payments", { rename: "has spaces" }, manifest, repoRoot),
        ).rejects.toThrow("Invalid namespace name");
      });

      it("refuses if a target file already exists on disk", async () => {
        const manifest = baseManifest();
        // billing/dev.enc.yaml already exists — refuse to clobber
        setupFs(manifest, ["/repo/payments/dev.enc.yaml", "/repo/billing/dev.enc.yaml"]);

        await expect(
          manager.editNamespace("payments", { rename: "billing" }, manifest, repoRoot),
        ).rejects.toThrow(/already exists/);
      });

      it("renames empty namespaces (no cells on disk) — manifest-only", async () => {
        const manifest = baseManifest();
        // No existing cells
        setupFs(manifest);

        await manager.editNamespace("payments", { rename: "billing" }, manifest, repoRoot);

        // No file ops
        expect(mockRenameSync).not.toHaveBeenCalled();
        // But the manifest IS updated
        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        expect(written.namespaces.find((n) => n.name === "billing")).toBeDefined();
      });
    });
  });

  describe("editEnvironment", () => {
    describe("manifest-only edits", () => {
      it("updates the description", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await manager.editEnvironment("dev", { description: "Local dev" }, manifest, repoRoot);

        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        const env = written.environments.find((e) => e.name === "dev");
        expect(env?.description).toBe("Local dev");
      });

      it("marks an environment as protected", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await manager.editEnvironment("dev", { protected: true }, manifest, repoRoot);

        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        const env = written.environments.find((e) => e.name === "dev");
        expect(env?.protected).toBe(true);
      });

      it("unprotects an environment", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await manager.editEnvironment("production", { protected: false }, manifest, repoRoot);

        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        const env = written.environments.find((e) => e.name === "production");
        expect(env?.protected).toBeUndefined();
      });

      it("throws on unknown environment", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await expect(
          manager.editEnvironment("nonexistent", { description: "x" }, manifest, repoRoot),
        ).rejects.toThrow("Environment 'nonexistent' not found");
      });
    });

    describe("rename", () => {
      it("renames cell files across all namespaces", async () => {
        const manifest = baseManifest();
        setupFs(manifest, ["/repo/payments/dev.enc.yaml", "/repo/auth/dev.enc.yaml"]);

        await manager.editEnvironment("dev", { rename: "development" }, manifest, repoRoot);

        expect(mockRenameSync).toHaveBeenCalledWith(
          "/repo/payments/dev.enc.yaml",
          "/repo/payments/development.enc.yaml",
        );
        expect(mockRenameSync).toHaveBeenCalledWith(
          "/repo/auth/dev.enc.yaml",
          "/repo/auth/development.enc.yaml",
        );
      });

      it("renames the env entry in the manifest environments array", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await manager.editEnvironment("dev", { rename: "development" }, manifest, repoRoot);

        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        expect(written.environments.find((e) => e.name === "development")).toBeDefined();
        expect(written.environments.find((e) => e.name === "dev")).toBeUndefined();
      });

      it("cascades the rename through SI environments map keys", async () => {
        const manifest = manifestWithSi();
        setupFs(manifest);

        await manager.editEnvironment("dev", { rename: "development" }, manifest, repoRoot);

        const writeCall = mockWriteFileAtomicSync.mock.calls.find((c) =>
          String(c[0]).endsWith("clef.yaml"),
        );
        const written = YAML.parse(writeCall![1] as string) as ClefManifest;
        const si = written.service_identities!.find((s) => s.name === "web-app")!;
        expect(si.environments).toHaveProperty("development");
        expect(si.environments).not.toHaveProperty("dev");
        // Order preserved — 'development' takes the slot 'dev' was in
        expect(Object.keys(si.environments)).toEqual(["development", "production"]);
        // Value preserved
        expect((si.environments.development as { recipient: string }).recipient).toBe("age1dev...");
      });

      it("refuses if the target name already exists", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await expect(
          manager.editEnvironment("dev", { rename: "production" }, manifest, repoRoot),
        ).rejects.toThrow("Environment 'production' already exists");
      });

      it("refuses invalid identifier", async () => {
        const manifest = baseManifest();
        setupFs(manifest);

        await expect(
          manager.editEnvironment("dev", { rename: "has/slash" }, manifest, repoRoot),
        ).rejects.toThrow("Invalid environment name");
      });

      it("refuses if a target file already exists on disk", async () => {
        const manifest = baseManifest();
        setupFs(manifest, ["/repo/payments/dev.enc.yaml", "/repo/payments/development.enc.yaml"]);

        await expect(
          manager.editEnvironment("dev", { rename: "development" }, manifest, repoRoot),
        ).rejects.toThrow(/already exists/);
      });
    });
  });
});
