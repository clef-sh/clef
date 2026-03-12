import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isGitUrl, resolveRemoteRepo } from "./remote";
import { SubprocessResult } from "../types";

jest.mock("fs");

const mockFs = fs as jest.Mocked<typeof fs>;

const ok: SubprocessResult = { stdout: "", stderr: "", exitCode: 0 };
const fail = (stderr: string): SubprocessResult => ({ stdout: "", stderr, exitCode: 1 });

function makeRunner(...results: SubprocessResult[]) {
  let i = 0;
  return { run: jest.fn().mockImplementation(() => Promise.resolve(results[i++] ?? ok)) };
}

function expectedCachePath(url: string): string {
  const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
  return path.join(os.homedir(), ".cache", "clef", hash);
}

// ─── isGitUrl ────────────────────────────────────────────────────────────────

describe("isGitUrl", () => {
  it("detects HTTPS URLs", () => {
    expect(isGitUrl("https://github.com/acme/secrets.git")).toBe(true);
  });

  it("detects HTTP URLs", () => {
    expect(isGitUrl("http://internal.corp/acme/secrets.git")).toBe(true);
  });

  it("detects SSH git URLs (github.com)", () => {
    expect(isGitUrl("git@github.com:acme/secrets.git")).toBe(true);
  });

  it("detects SSH git URLs (gitlab)", () => {
    expect(isGitUrl("git@gitlab.com:org/repo.git")).toBe(true);
  });

  it("detects SSH git URLs (custom host)", () => {
    expect(isGitUrl("git@git.internal.corp:team/secrets")).toBe(true);
  });

  it("returns false for absolute local paths", () => {
    expect(isGitUrl("/home/user/repos/secrets")).toBe(false);
  });

  it("returns false for relative local paths", () => {
    expect(isGitUrl("../acme-secrets")).toBe(false);
  });

  it("returns false for plain directory names", () => {
    expect(isGitUrl("my-secrets-repo")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGitUrl("")).toBe(false);
  });
});

// ─── resolveRemoteRepo ───────────────────────────────────────────────────────

describe("resolveRemoteRepo", () => {
  const url = "git@github.com:acme/secrets.git";
  const localPath = expectedCachePath(url);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fresh clone (cache miss)", () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
    });

    it("clones with depth 1 and no branch when branch is undefined", async () => {
      const runner = makeRunner(ok);

      const result = await resolveRemoteRepo(url, undefined, runner);

      expect(result).toBe(localPath);
      expect(runner.run).toHaveBeenCalledTimes(1);
      expect(runner.run).toHaveBeenCalledWith("git", ["clone", "--depth", "1", url, localPath]);
    });

    it("passes --branch when branch is specified", async () => {
      const runner = makeRunner(ok);

      await resolveRemoteRepo(url, "feature/new-payment-gateway", runner);

      expect(runner.run).toHaveBeenCalledWith("git", [
        "clone",
        "--depth",
        "1",
        "--branch",
        "feature/new-payment-gateway",
        url,
        localPath,
      ]);
    });

    it("returns the cache path on success", async () => {
      const runner = makeRunner(ok);
      const result = await resolveRemoteRepo(url, undefined, runner);
      expect(result).toBe(localPath);
    });

    it("throws with a clear message on clone failure", async () => {
      const runner = makeRunner(fail("repository not found"));

      await expect(resolveRemoteRepo(url, undefined, runner)).rejects.toThrow("Failed to clone");
    });

    it("includes the URL in the error message", async () => {
      const runner = makeRunner(fail("authentication required"));

      await expect(resolveRemoteRepo(url, undefined, runner)).rejects.toThrow(url);
    });
  });

  describe("update existing clone (cache hit)", () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
    });

    it("fetches origin and resets to origin/HEAD when no branch specified", async () => {
      const runner = makeRunner(ok, ok);

      const result = await resolveRemoteRepo(url, undefined, runner);

      expect(result).toBe(localPath);
      expect(runner.run).toHaveBeenCalledTimes(2);
      expect(runner.run).toHaveBeenNthCalledWith(1, "git", ["fetch", "--depth", "1", "origin"], {
        cwd: localPath,
      });
      expect(runner.run).toHaveBeenNthCalledWith(2, "git", ["reset", "--hard", "origin/HEAD"], {
        cwd: localPath,
      });
    });

    it("fetches the specified branch and resets to origin/<branch>", async () => {
      const runner = makeRunner(ok, ok);

      await resolveRemoteRepo(url, "main", runner);

      expect(runner.run).toHaveBeenNthCalledWith(
        1,
        "git",
        ["fetch", "--depth", "1", "origin", "main"],
        { cwd: localPath },
      );
      expect(runner.run).toHaveBeenNthCalledWith(2, "git", ["reset", "--hard", "origin/main"], {
        cwd: localPath,
      });
    });

    it("throws on fetch failure", async () => {
      const runner = makeRunner(fail("authentication failed"));

      await expect(resolveRemoteRepo(url, undefined, runner)).rejects.toThrow("Failed to fetch");
    });

    it("throws on reset failure", async () => {
      const runner = makeRunner(ok, fail("unknown ref origin/HEAD"));

      await expect(resolveRemoteRepo(url, undefined, runner)).rejects.toThrow("Failed to reset");
    });

    it("does not call clone when the cache directory exists", async () => {
      const runner = makeRunner(ok, ok);

      await resolveRemoteRepo(url, undefined, runner);

      const calls = runner.run.mock.calls.map((c) => c[1][0]);
      expect(calls).not.toContain("clone");
    });
  });

  describe("cache path is deterministic", () => {
    it("produces the same path for the same URL", () => {
      const a = expectedCachePath(url);
      const b = expectedCachePath(url);
      expect(a).toBe(b);
    });

    it("produces different paths for different URLs", () => {
      const a = expectedCachePath("git@github.com:acme/secrets.git");
      const b = expectedCachePath("git@github.com:acme/other-secrets.git");
      expect(a).not.toBe(b);
    });
  });
});
