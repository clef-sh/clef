import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveManifestPath } from "./manifest-path";

/**
 * The walk-up traversal is security-critical: resolving to the wrong manifest
 * would pack secrets against the wrong service identity. Tests cover explicit
 * paths, walk-up discovery, and every boundary where the walk must stop.
 */
describe("resolveManifestPath", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clef-cdk-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns the explicit path when the file exists", () => {
    const manifestPath = path.join(tmpRoot, "clef.yaml");
    fs.writeFileSync(manifestPath, "version: 1\n");
    expect(resolveManifestPath(manifestPath)).toBe(manifestPath);
  });

  it("resolves an explicit relative path against cwd", () => {
    const manifestPath = path.join(tmpRoot, "clef.yaml");
    fs.writeFileSync(manifestPath, "version: 1\n");
    expect(resolveManifestPath("clef.yaml", tmpRoot)).toBe(manifestPath);
  });

  it("throws a specific message when an explicit path is missing", () => {
    const missing = path.join(tmpRoot, "nope.yaml");
    expect(() => resolveManifestPath(missing)).toThrow(/Clef manifest not found at/);
  });

  it("finds clef.yaml in the cwd itself", () => {
    const manifestPath = path.join(tmpRoot, "clef.yaml");
    fs.writeFileSync(manifestPath, "version: 1\n");
    expect(resolveManifestPath(undefined, tmpRoot)).toBe(manifestPath);
  });

  it("walks up to find clef.yaml in a parent directory", () => {
    const manifestPath = path.join(tmpRoot, "clef.yaml");
    fs.writeFileSync(manifestPath, "version: 1\n");
    const nested = path.join(tmpRoot, "infra", "cdk");
    fs.mkdirSync(nested, { recursive: true });
    expect(resolveManifestPath(undefined, nested)).toBe(manifestPath);
  });

  it("stops at git root (inclusive) and still matches a manifest there", () => {
    const gitRoot = path.join(tmpRoot, "repo");
    fs.mkdirSync(path.join(gitRoot, ".git"), { recursive: true });
    const manifestPath = path.join(gitRoot, "clef.yaml");
    fs.writeFileSync(manifestPath, "version: 1\n");
    const nested = path.join(gitRoot, "services", "api");
    fs.mkdirSync(nested, { recursive: true });
    expect(resolveManifestPath(undefined, nested)).toBe(manifestPath);
  });

  it("does not walk past the git root", () => {
    const gitRoot = path.join(tmpRoot, "repo");
    fs.mkdirSync(path.join(gitRoot, ".git"), { recursive: true });
    // Manifest above the git root — must NOT be found.
    fs.writeFileSync(path.join(tmpRoot, "clef.yaml"), "version: 1\n");
    const nested = path.join(gitRoot, "services");
    fs.mkdirSync(nested, { recursive: true });
    expect(() => resolveManifestPath(undefined, nested)).toThrow(/Could not find clef.yaml/);
  });

  it("throws when no manifest exists anywhere up the tree", () => {
    const nested = path.join(tmpRoot, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    // tmpRoot is inside os.tmpdir(), which sits above home on most systems,
    // so walk-up will bail at the filesystem root.
    expect(() => resolveManifestPath(undefined, nested)).toThrow(/Could not find clef.yaml/);
  });
});
