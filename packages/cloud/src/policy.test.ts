import * as path from "path";
import { scaffoldPolicyFile, parsePolicyFile, POLICY_FILE_PATH, POLICY_TEMPLATE } from "./policy";

jest.mock("fs");

const fsMock = jest.requireMock("fs") as {
  existsSync: jest.Mock;
  mkdirSync: jest.Mock;
  readFileSync: jest.Mock;
  writeFileSync: jest.Mock;
};

const REPO_ROOT = "/repo";
const POLICY_ABS = path.join(REPO_ROOT, POLICY_FILE_PATH);
const GITIGNORE_ABS = path.join(REPO_ROOT, ".clef/.gitignore");

// ── scaffoldPolicyFile ────────────────────────────────────────────────────────

describe("scaffoldPolicyFile", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns created: false when policy file already exists", () => {
    fsMock.existsSync.mockImplementation((p: string) => p === POLICY_ABS);

    const result = scaffoldPolicyFile(REPO_ROOT);

    expect(result.created).toBe(false);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it("creates directory, updates gitignore, and writes policy when file absent", () => {
    fsMock.existsSync.mockReturnValue(false);
    fsMock.readFileSync.mockReturnValue("*\n");

    const result = scaffoldPolicyFile(REPO_ROOT);

    expect(result.created).toBe(true);
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(path.dirname(POLICY_ABS), { recursive: true });
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(POLICY_ABS, POLICY_TEMPLATE, "utf-8");
  });

  it("appends !policy.yaml to existing gitignore that lacks it", () => {
    fsMock.existsSync.mockImplementation((p: string) => p === GITIGNORE_ABS);
    fsMock.readFileSync.mockReturnValue("*\n");

    scaffoldPolicyFile(REPO_ROOT);

    expect(fsMock.writeFileSync).toHaveBeenCalledWith(GITIGNORE_ABS, "*\n!policy.yaml\n", "utf-8");
  });

  it("does not duplicate !policy.yaml if already present in gitignore", () => {
    fsMock.existsSync.mockImplementation((p: string) => p === GITIGNORE_ABS);
    fsMock.readFileSync.mockReturnValue("*\n!policy.yaml\n");

    scaffoldPolicyFile(REPO_ROOT);

    // writeFileSync should only be called for the policy file itself, not gitignore
    const gitignoreWrites = (fsMock.writeFileSync.mock.calls as [string, ...unknown[]][]).filter(
      ([p]) => p === GITIGNORE_ABS,
    );
    expect(gitignoreWrites).toHaveLength(0);
  });

  it("creates gitignore with exception when it does not exist", () => {
    fsMock.existsSync.mockReturnValue(false);

    scaffoldPolicyFile(REPO_ROOT);

    expect(fsMock.writeFileSync).toHaveBeenCalledWith(GITIGNORE_ABS, "*\n!policy.yaml\n", "utf-8");
  });
});

// ── parsePolicyFile ───────────────────────────────────────────────────────────

describe("parsePolicyFile", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns valid: true for a well-formed policy file", () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue("version: 1\nscan:\n  enabled: true\n");

    expect(parsePolicyFile(REPO_ROOT)).toEqual({ valid: true });
  });

  it("returns valid: false when file cannot be read", () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = parsePolicyFile(REPO_ROOT);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; reason: string }).reason).toMatch(/Could not read/);
  });

  it("returns valid: false for invalid YAML", () => {
    fsMock.readFileSync.mockReturnValue("version: [\nbad yaml");

    const result = parsePolicyFile(REPO_ROOT);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; reason: string }).reason).toMatch(/Invalid YAML/);
  });

  it("returns valid: false when version field is missing", () => {
    fsMock.readFileSync.mockReturnValue("scan:\n  enabled: true\n");

    const result = parsePolicyFile(REPO_ROOT);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; reason: string }).reason).toMatch(/version/);
  });

  it("returns valid: false when version is not 1", () => {
    fsMock.readFileSync.mockReturnValue("version: 2\n");

    const result = parsePolicyFile(REPO_ROOT);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; reason: string }).reason).toMatch(/Expected version: 1/);
  });

  it("returns valid: false for an empty file", () => {
    fsMock.readFileSync.mockReturnValue("");

    const result = parsePolicyFile(REPO_ROOT);
    expect(result.valid).toBe(false);
  });
});
