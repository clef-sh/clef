import * as fs from "fs";
import * as YAML from "yaml";
import {
  metadataPath,
  loadMetadata,
  saveMetadata,
  markPending,
  markPendingWithRetry,
  markResolved,
  getPendingKeys,
  isPending,
  generateRandomValue,
} from "./metadata";

jest.mock("fs");
jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto");
  return {
    ...actual,
    randomBytes: jest.fn((size: number) => actual.randomBytes(size) as Buffer),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports -- require() is necessary to access the Jest mock after jest.mock()
const mockCrypto = require("crypto") as { randomBytes: jest.Mock };

const mockedFs = jest.mocked(fs);

const SAMPLE_PENDING_YAML = YAML.stringify({
  version: 1,
  pending: [
    { key: "DB_PASSWORD", since: "2026-03-01T00:00:00.000Z", setBy: "alice" },
    { key: "API_KEY", since: "2026-03-02T12:00:00.000Z", setBy: "bob" },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("metadataPath", () => {
  it("should derive .clef-meta.yaml from .enc.yaml path", () => {
    expect(metadataPath("database/dev.enc.yaml")).toBe("database/dev.clef-meta.yaml");
  });

  it("should handle nested directory paths", () => {
    expect(metadataPath("infra/staging/secrets.enc.yaml")).toBe(
      "infra/staging/secrets.clef-meta.yaml",
    );
  });

  it("should handle root-level files", () => {
    expect(metadataPath("prod.enc.yaml")).toBe("prod.clef-meta.yaml");
  });

  it("should handle absolute paths", () => {
    expect(metadataPath("/home/user/project/config.enc.yaml")).toBe(
      "/home/user/project/config.clef-meta.yaml",
    );
  });
});

describe("loadMetadata", () => {
  it("should return correct PendingMetadata from existing file", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(SAMPLE_PENDING_YAML);

    const result = await loadMetadata("database/dev.enc.yaml");

    expect(result.version).toBe(1);
    expect(result.pending).toHaveLength(2);
    expect(result.pending[0].key).toBe("DB_PASSWORD");
    expect(result.pending[0].since).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    expect(result.pending[0].setBy).toBe("alice");
    expect(result.pending[1].key).toBe("API_KEY");
    expect(result.pending[1].since).toEqual(new Date("2026-03-02T12:00:00.000Z"));
    expect(result.pending[1].setBy).toBe("bob");
  });

  it("should return empty pending array when file does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    const result = await loadMetadata("database/dev.enc.yaml");

    expect(result).toEqual({ version: 1, pending: [] });
    expect(mockedFs.readFileSync).not.toHaveBeenCalled();
  });

  it("should return empty pending array when file has invalid content", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("not valid yaml: [[[");

    const result = await loadMetadata("database/dev.enc.yaml");

    expect(result).toEqual({ version: 1, pending: [] });
  });

  it("should return empty pending array when parsed content has no pending array", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(YAML.stringify({ version: 1, something: "else" }));

    const result = await loadMetadata("database/dev.enc.yaml");

    expect(result).toEqual({ version: 1, pending: [] });
  });

  it("should return empty pending array when readFileSync throws", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const result = await loadMetadata("database/dev.enc.yaml");

    expect(result).toEqual({ version: 1, pending: [] });
  });
});

describe("saveMetadata", () => {
  it("should write YAML with header comment to derived path", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    const metadata = {
      version: 1 as const,
      pending: [{ key: "SECRET", since: new Date("2026-03-10T00:00:00.000Z"), setBy: "charlie" }],
    };

    await saveMetadata("app/config.enc.yaml", metadata);

    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = mockedFs.writeFileSync.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(writtenPath).toBe("app/config.clef-meta.yaml");
    expect(writtenContent).toContain("# Managed by Clef. Do not edit manually.");
    const parsed = YAML.parse(writtenContent);
    expect(parsed.version).toBe(1);
    expect(parsed.pending).toHaveLength(1);
    expect(parsed.pending[0].key).toBe("SECRET");
    expect(parsed.pending[0].since).toBe("2026-03-10T00:00:00.000Z");
    expect(parsed.pending[0].setBy).toBe("charlie");
  });

  it("should create directory if it does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockImplementation(() => undefined as unknown as string);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    const metadata = { version: 1 as const, pending: [] };

    await saveMetadata("deep/nested/dir/secrets.enc.yaml", metadata);

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith("deep/nested/dir", { recursive: true });
  });
});

describe("markPending", () => {
  it("should add new keys to empty metadata", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    await markPending("app/dev.enc.yaml", ["NEW_SECRET", "ANOTHER_SECRET"], "dave");

    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);
    const writtenContent = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = YAML.parse(writtenContent);
    expect(parsed.pending).toHaveLength(2);
    expect(parsed.pending[0].key).toBe("NEW_SECRET");
    expect(parsed.pending[0].setBy).toBe("dave");
    expect(parsed.pending[1].key).toBe("ANOTHER_SECRET");
    expect(parsed.pending[1].setBy).toBe("dave");
  });

  it("should preserve existing pending entries and add new ones", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(SAMPLE_PENDING_YAML);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    await markPending("database/dev.enc.yaml", ["NEW_KEY"], "charlie");

    const writtenContent = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = YAML.parse(writtenContent);
    expect(parsed.pending).toHaveLength(3);
    expect(parsed.pending[0].key).toBe("DB_PASSWORD");
    expect(parsed.pending[1].key).toBe("API_KEY");
    expect(parsed.pending[2].key).toBe("NEW_KEY");
    expect(parsed.pending[2].setBy).toBe("charlie");
  });

  it("should upsert existing keys (update since and setBy) on re-randomization", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(SAMPLE_PENDING_YAML);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    await markPending("database/dev.enc.yaml", ["DB_PASSWORD", "BRAND_NEW"], "eve");

    const writtenContent = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = YAML.parse(writtenContent);
    // DB_PASSWORD should be updated (not duplicated); BRAND_NEW added
    expect(parsed.pending).toHaveLength(3);
    const keys = parsed.pending.map((p: { key: string }) => p.key);
    expect(keys).toEqual(["DB_PASSWORD", "API_KEY", "BRAND_NEW"]);
    // DB_PASSWORD should have the new setBy
    expect(parsed.pending[0].setBy).toBe("eve");
  });

  it("should update since timestamp on re-randomization", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(SAMPLE_PENDING_YAML);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    await markPending("database/dev.enc.yaml", ["DB_PASSWORD"], "new-user");

    const writtenContent = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = YAML.parse(writtenContent);
    expect(parsed.pending).toHaveLength(2);
    // DB_PASSWORD should have updated setBy and since should be recent
    expect(parsed.pending[0].setBy).toBe("new-user");
    const updatedSince = new Date(parsed.pending[0].since);
    expect(updatedSince.getTime()).toBeGreaterThan(new Date("2026-03-01").getTime());
  });
});

describe("markResolved", () => {
  it("should remove the specified keys and leave others", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(SAMPLE_PENDING_YAML);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    await markResolved("database/dev.enc.yaml", ["DB_PASSWORD"]);

    const writtenContent = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = YAML.parse(writtenContent);
    expect(parsed.pending).toHaveLength(1);
    expect(parsed.pending[0].key).toBe("API_KEY");
  });

  it("should remove multiple keys at once", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(SAMPLE_PENDING_YAML);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    await markResolved("database/dev.enc.yaml", ["DB_PASSWORD", "API_KEY"]);

    const writtenContent = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = YAML.parse(writtenContent);
    expect(parsed.pending).toHaveLength(0);
  });

  it("should not error when resolving a non-pending key", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(SAMPLE_PENDING_YAML);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    await expect(
      markResolved("database/dev.enc.yaml", ["NONEXISTENT_KEY"]),
    ).resolves.toBeUndefined();

    const writtenContent = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = YAML.parse(writtenContent);
    // Original entries unchanged
    expect(parsed.pending).toHaveLength(2);
    expect(parsed.pending[0].key).toBe("DB_PASSWORD");
    expect(parsed.pending[1].key).toBe("API_KEY");
  });
});

describe("getPendingKeys", () => {
  it("should return array of key strings from metadata", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(SAMPLE_PENDING_YAML);

    const keys = await getPendingKeys("database/dev.enc.yaml");

    expect(keys).toEqual(["DB_PASSWORD", "API_KEY"]);
  });

  it("should return empty array when no metadata file exists", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    const keys = await getPendingKeys("database/dev.enc.yaml");

    expect(keys).toEqual([]);
  });
});

describe("isPending", () => {
  it("should return true for a key that is pending", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(SAMPLE_PENDING_YAML);

    expect(await isPending("database/dev.enc.yaml", "DB_PASSWORD")).toBe(true);
  });

  it("should return false for a key that is not pending", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(SAMPLE_PENDING_YAML);

    expect(await isPending("database/dev.enc.yaml", "UNKNOWN_KEY")).toBe(false);
  });
});

describe("generateRandomValue", () => {
  it("should return a 64-character hex string", () => {
    const value = generateRandomValue();

    expect(value).toHaveLength(64);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should return different values on successive calls", () => {
    const value1 = generateRandomValue();
    const value2 = generateRandomValue();

    expect(value1).not.toBe(value2);
  });

  it("uses crypto.randomBytes as entropy source", () => {
    mockCrypto.randomBytes.mockClear();
    generateRandomValue();
    expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32);
  });
});

describe("markPendingWithRetry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should succeed on first attempt without retry", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    await markPendingWithRetry("app/dev.enc.yaml", ["KEY"], "test");

    // writeFileSync called exactly once (first attempt succeeded)
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("should retry once and succeed after first failure", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    let callCount = 0;
    mockedFs.writeFileSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error("EBUSY: resource busy");
      }
    });

    const promise = markPendingWithRetry("app/dev.enc.yaml", ["KEY"], "test");
    // Flush microtasks then advance past the retry delay
    await jest.advanceTimersByTimeAsync(200);
    await promise;

    // writeFileSync called twice (first failed, second succeeded)
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it("should throw when both attempts fail", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.writeFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });

    // Catch rejection eagerly to avoid unhandled rejection during timer advancement
    const promise = markPendingWithRetry("app/dev.enc.yaml", ["KEY"], "test").catch(
      (e: Error) => e,
    );
    await jest.advanceTimersByTimeAsync(200);
    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("disk full");
  });

  it("should use approximately 200ms retry delay", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    let callCount = 0;
    mockedFs.writeFileSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error("transient");
      }
    });

    const promise = markPendingWithRetry("app/dev.enc.yaml", ["KEY"], "test");

    // Flush microtasks so the first markPending call completes and setTimeout is registered
    await jest.advanceTimersByTimeAsync(0);
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);

    // After 199ms total, retry should not have happened yet
    await jest.advanceTimersByTimeAsync(199);
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);

    // After 200ms total, retry should happen
    await jest.advanceTimersByTimeAsync(1);
    await promise;
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it("should pass correct arguments through to markPending", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.writeFileSync.mockImplementation(() => undefined);

    await markPendingWithRetry("app/dev.enc.yaml", ["SECRET_KEY"], "clef ui");

    const writtenContent = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = YAML.parse(writtenContent);
    expect(parsed.pending[0].key).toBe("SECRET_KEY");
    expect(parsed.pending[0].setBy).toBe("clef ui");
  });
});
