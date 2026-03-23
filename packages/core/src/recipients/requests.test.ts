import * as fs from "fs";
import * as path from "path";
import {
  REQUESTS_FILENAME,
  requestsFilePath,
  loadRequests,
  saveRequests,
  upsertRequest,
  removeRequest,
  findRequest,
} from "./requests";

jest.mock("fs");

const mockFs = fs as jest.Mocked<typeof fs>;

const REPO_ROOT = "/fake/repo";
const EXPECTED_PATH = path.join(REPO_ROOT, REQUESTS_FILENAME);

describe("requests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("requestsFilePath", () => {
    it("should return path to .clef-requests.yaml in repo root", () => {
      expect(requestsFilePath(REPO_ROOT)).toBe(EXPECTED_PATH);
    });
  });

  describe("loadRequests", () => {
    it("should return empty array when file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(loadRequests(REPO_ROOT)).toEqual([]);
    });

    it("should parse valid YAML", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        "requests:\n" +
          '  - key: "age1abc"\n' +
          '    label: "Alice"\n' +
          '    requested_at: "2026-03-20T15:00:00.000Z"\n' +
          '    environment: "staging"\n',
      );
      const result = loadRequests(REPO_ROOT);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("age1abc");
      expect(result[0].label).toBe("Alice");
      expect(result[0].requestedAt).toEqual(new Date("2026-03-20T15:00:00.000Z"));
      expect(result[0].environment).toBe("staging");
    });

    it("should parse request without environment", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        "requests:\n" +
          '  - key: "age1abc"\n' +
          '    label: "Alice"\n' +
          '    requested_at: "2026-03-20T15:00:00.000Z"\n',
      );
      const result = loadRequests(REPO_ROOT);
      expect(result[0].environment).toBeUndefined();
    });

    it("should return empty array for malformed YAML", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("not valid yaml: [[[");
      expect(loadRequests(REPO_ROOT)).toEqual([]);
    });

    it("should return empty array when requests field is missing", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("version: 1\n");
      expect(loadRequests(REPO_ROOT)).toEqual([]);
    });

    it("should return empty array when readFileSync throws", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("EACCES");
      });
      expect(loadRequests(REPO_ROOT)).toEqual([]);
    });
  });

  describe("saveRequests", () => {
    it("should write YAML with header comment", () => {
      saveRequests(REPO_ROOT, [
        {
          key: "age1abc",
          label: "Alice",
          requestedAt: new Date("2026-03-20T15:00:00.000Z"),
        },
      ]);
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      const [filePath, content] = mockFs.writeFileSync.mock.calls[0] as [string, string, string];
      expect(filePath).toBe(EXPECTED_PATH);
      expect(content).toContain("# Pending recipient access requests");
      expect(content).toContain("age1abc");
      expect(content).toContain("Alice");
      expect(content).toContain("2026-03-20T15:00:00.000Z");
    });

    it("should include environment when present", () => {
      saveRequests(REPO_ROOT, [
        {
          key: "age1abc",
          label: "Alice",
          requestedAt: new Date("2026-03-20T15:00:00.000Z"),
          environment: "staging",
        },
      ]);
      const content = (mockFs.writeFileSync.mock.calls[0] as [string, string, string])[1];
      expect(content).toContain("staging");
    });

    it("should omit environment when undefined", () => {
      saveRequests(REPO_ROOT, [
        {
          key: "age1abc",
          label: "Alice",
          requestedAt: new Date("2026-03-20T15:00:00.000Z"),
        },
      ]);
      const content = (mockFs.writeFileSync.mock.calls[0] as [string, string, string])[1];
      expect(content).not.toContain("environment");
    });

    it("should delete file when requests array is empty", () => {
      saveRequests(REPO_ROOT, []);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(EXPECTED_PATH);
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should not throw when unlinkSync fails on empty save", () => {
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(() => saveRequests(REPO_ROOT, [])).not.toThrow();
    });
  });

  describe("upsertRequest", () => {
    it("should add a new request", () => {
      mockFs.existsSync.mockReturnValue(false);
      const result = upsertRequest(REPO_ROOT, "age1new", "Bob");
      expect(result.key).toBe("age1new");
      expect(result.label).toBe("Bob");
      expect(result.requestedAt).toBeInstanceOf(Date);
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it("should update existing request with same key", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        "requests:\n" +
          '  - key: "age1existing"\n' +
          '    label: "OldName"\n' +
          '    requested_at: "2026-01-01T00:00:00.000Z"\n',
      );
      const result = upsertRequest(REPO_ROOT, "age1existing", "NewName", "staging");
      expect(result.label).toBe("NewName");
      expect(result.environment).toBe("staging");
      const content = (mockFs.writeFileSync.mock.calls[0] as [string, string, string])[1];
      expect(content).toContain("NewName");
      expect(content).not.toContain("OldName");
    });

    it("should pass environment through", () => {
      mockFs.existsSync.mockReturnValue(false);
      const result = upsertRequest(REPO_ROOT, "age1env", "Env User", "production");
      expect(result.environment).toBe("production");
    });
  });

  describe("removeRequest", () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        "requests:\n" +
          '  - key: "age1alice"\n' +
          '    label: "Alice"\n' +
          '    requested_at: "2026-03-20T15:00:00.000Z"\n' +
          '  - key: "age1bob"\n' +
          '    label: "Bob"\n' +
          '    requested_at: "2026-03-21T10:00:00.000Z"\n',
      );
    });

    it("should remove by label (case-insensitive)", () => {
      const removed = removeRequest(REPO_ROOT, "alice");
      expect(removed).not.toBeNull();
      expect(removed!.key).toBe("age1alice");
      const content = (mockFs.writeFileSync.mock.calls[0] as [string, string, string])[1];
      expect(content).toContain("age1bob");
      expect(content).not.toContain("age1alice");
    });

    it("should remove by exact key", () => {
      const removed = removeRequest(REPO_ROOT, "age1bob");
      expect(removed).not.toBeNull();
      expect(removed!.label).toBe("Bob");
    });

    it("should return null when not found", () => {
      expect(removeRequest(REPO_ROOT, "nobody")).toBeNull();
    });

    it("should delete file when last request is removed", () => {
      mockFs.readFileSync.mockReturnValue(
        "requests:\n" +
          '  - key: "age1only"\n' +
          '    label: "Only"\n' +
          '    requested_at: "2026-03-20T15:00:00.000Z"\n',
      );
      removeRequest(REPO_ROOT, "Only");
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(EXPECTED_PATH);
    });
  });

  describe("findRequest", () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        "requests:\n" +
          '  - key: "age1alice"\n' +
          '    label: "Alice"\n' +
          '    requested_at: "2026-03-20T15:00:00.000Z"\n',
      );
    });

    it("should find by label (case-insensitive)", () => {
      const found = findRequest(REPO_ROOT, "ALICE");
      expect(found).not.toBeNull();
      expect(found!.key).toBe("age1alice");
    });

    it("should find by exact key", () => {
      const found = findRequest(REPO_ROOT, "age1alice");
      expect(found).not.toBeNull();
      expect(found!.label).toBe("Alice");
    });

    it("should return null when not found", () => {
      expect(findRequest(REPO_ROOT, "unknown")).toBeNull();
    });

    it("should return null when file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(findRequest(REPO_ROOT, "Alice")).toBeNull();
    });
  });
});
