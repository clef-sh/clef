import {
  checkDependency,
  checkAll,
  assertSops,
  parseSopsVersion,
  parseGitVersion,
  semverSatisfied,
  REQUIREMENTS,
} from "./checker";
import { SopsMissingError, SopsVersionError, SubprocessRunner } from "../types";

function makeRunner(
  responses: Record<string, { stdout: string; stderr: string; exitCode: number }>,
): SubprocessRunner {
  return {
    run: jest.fn(async (command: string) => {
      if (responses[command]) return responses[command];
      return { stdout: "", stderr: `${command}: command not found`, exitCode: 127 };
    }),
  };
}

describe("version string parsers", () => {
  it("should parse sops version from real output", () => {
    expect(parseSopsVersion("sops 3.8.1 (latest)")).toBe("3.8.1");
  });

  it("should parse sops version without suffix", () => {
    expect(parseSopsVersion("sops 3.9.4")).toBe("3.9.4");
  });

  it("should parse sops version from multiline output with warnings", () => {
    const output = "sops 3.12.1 (latest)\n\n[warning] Note that in a future version...";
    expect(parseSopsVersion(output)).toBe("3.12.1");
  });

  it("should return null for unparseable sops output", () => {
    expect(parseSopsVersion("unknown")).toBeNull();
  });

  it("should parse git version from real output", () => {
    expect(parseGitVersion("git version 2.43.0")).toBe("2.43.0");
  });

  it("should parse git version with Apple suffix", () => {
    expect(parseGitVersion("git version 2.50.1 (Apple Git-155)")).toBe("2.50.1");
  });

  it("should return null for unparseable git output", () => {
    expect(parseGitVersion("unknown")).toBeNull();
  });
});

describe("semverSatisfied", () => {
  it("should return true when versions are equal", () => {
    expect(semverSatisfied("3.8.0", "3.8.0")).toBe(true);
  });

  it("should return true when installed is newer (patch)", () => {
    expect(semverSatisfied("3.8.1", "3.8.0")).toBe(true);
  });

  it("should return true when installed is newer (minor)", () => {
    expect(semverSatisfied("3.9.0", "3.8.0")).toBe(true);
  });

  it("should return true when installed is newer (major)", () => {
    expect(semverSatisfied("4.0.0", "3.8.0")).toBe(true);
  });

  it("should return false when installed is older (patch)", () => {
    expect(semverSatisfied("3.7.9", "3.8.0")).toBe(false);
  });

  it("should return false when installed is older (minor)", () => {
    expect(semverSatisfied("3.7.0", "3.8.0")).toBe(false);
  });

  it("should return false when installed is older (major)", () => {
    expect(semverSatisfied("2.9.9", "3.8.0")).toBe(false);
  });

  it("should return false for invalid version strings", () => {
    expect(semverSatisfied("abc", "3.8.0")).toBe(false);
  });
});

describe("checkDependency", () => {
  it("should return satisfied DependencyVersion when version meets requirement", async () => {
    const runner = makeRunner({
      sops: { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 },
    });

    const result = await checkDependency("sops", runner);

    expect(result).not.toBeNull();
    expect(result!.installed).toBe("3.9.4");
    expect(result!.required).toBe(REQUIREMENTS.sops);
    expect(result!.satisfied).toBe(true);
    expect(result!.installHint).toBeTruthy();
  });

  it("should return unsatisfied when version is below minimum", async () => {
    const runner = makeRunner({
      sops: { stdout: "sops 3.7.2", stderr: "", exitCode: 0 },
    });

    const result = await checkDependency("sops", runner);

    expect(result).not.toBeNull();
    expect(result!.installed).toBe("3.7.2");
    expect(result!.satisfied).toBe(false);
  });

  it("should return null when binary is not found", async () => {
    const runner = makeRunner({});

    const result = await checkDependency("sops", runner);
    expect(result).toBeNull();
  });

  it("should return null when version string is unparseable", async () => {
    const runner = makeRunner({
      sops: { stdout: "garbled output", stderr: "", exitCode: 0 },
    });

    const result = await checkDependency("sops", runner);
    expect(result).toBeNull();
  });

  it("should return null when runner throws", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockRejectedValue(new Error("spawn failed")),
    };

    const result = await checkDependency("sops", runner);
    expect(result).toBeNull();
  });

  it("should check git version correctly", async () => {
    const runner = makeRunner({
      git: { stdout: "git version 2.43.0", stderr: "", exitCode: 0 },
    });

    const result = await checkDependency("git", runner);

    expect(result).not.toBeNull();
    expect(result!.installed).toBe("2.43.0");
    expect(result!.satisfied).toBe(true);
  });
});

describe("checkAll", () => {
  it("should run sops and git checks in parallel", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (command: string) => {
        switch (command) {
          case "sops":
            return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
          case "git":
            return { stdout: "git version 2.43.0", stderr: "", exitCode: 0 };
          default:
            return { stdout: "", stderr: "", exitCode: 127 };
        }
      }),
    };

    const status = await checkAll(runner);

    expect(status.sops).not.toBeNull();
    expect(status.git).not.toBeNull();
    expect(status.sops!.satisfied).toBe(true);
    expect(status.git!.satisfied).toBe(true);
    // Verify both were called (parallel execution via Promise.all)
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it("should handle partial failures", async () => {
    const runner: SubprocessRunner = {
      run: jest.fn().mockImplementation(async (command: string) => {
        if (command === "sops") return { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "not found", exitCode: 127 };
      }),
    };

    const status = await checkAll(runner);

    expect(status.sops).not.toBeNull();
    expect(status.git).toBeNull();
  });
});

describe("assertSops", () => {
  it("should resolve when sops is installed and version is satisfied", async () => {
    const runner = makeRunner({
      sops: { stdout: "sops 3.9.4 (latest)", stderr: "", exitCode: 0 },
    });

    await expect(assertSops(runner)).resolves.toBeUndefined();
  });

  it("should throw SopsMissingError when sops is not found", async () => {
    const runner = makeRunner({});

    await expect(assertSops(runner)).rejects.toThrow(SopsMissingError);
  });

  it("should throw SopsVersionError when sops is below minimum", async () => {
    const runner = makeRunner({
      sops: { stdout: "sops 3.7.2", stderr: "", exitCode: 0 },
    });

    const err = await assertSops(runner).catch((e) => e);
    expect(err).toBeInstanceOf(SopsVersionError);
    expect(err.installed).toBe("3.7.2");
    expect(err.required).toBe(REQUIREMENTS.sops);
    expect(err.installHint).toBeTruthy();
  });
});

describe("getInstallHint (platform branches)", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("should return non-brew hints for sops on linux", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const runner = makeRunner({
      sops: { stdout: "sops 3.9.4", stderr: "", exitCode: 0 },
    });

    const result = await checkDependency("sops", runner);
    expect(result).not.toBeNull();
    expect(result!.installHint).toContain("https://github.com/getsops/sops/releases");
  });

  it("should return apt hint for git on linux", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const runner = makeRunner({
      git: { stdout: "git version 2.43.0", stderr: "", exitCode: 0 },
    });

    const result = await checkDependency("git", runner);
    expect(result).not.toBeNull();
    expect(result!.installHint).toBe("apt install git");
  });

  it("should return fallback hint for git on win32", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const runner = makeRunner({
      git: { stdout: "git version 2.43.0", stderr: "", exitCode: 0 },
    });

    const result = await checkDependency("git", runner);
    expect(result).not.toBeNull();
    expect(result!.installHint).toContain("https://git-scm.com/downloads");
  });
});

describe("error classes", () => {
  it("SopsMissingError has installHint", () => {
    const err = new SopsMissingError("brew install sops");
    expect(err.installHint).toBe("brew install sops");
    expect(err.name).toBe("SopsMissingError");
    expect(err.message).toContain("not installed");
  });

  it("SopsVersionError has installed and required", () => {
    const err = new SopsVersionError("3.7.2", "3.8.0", "brew upgrade sops");
    expect(err.installed).toBe("3.7.2");
    expect(err.required).toBe("3.8.0");
    expect(err.installHint).toBe("brew upgrade sops");
    expect(err.name).toBe("SopsVersionError");
  });
});
