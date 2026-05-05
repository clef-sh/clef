import { wrapWithLinuxStdinFifo, shouldUseLinuxStdinFifo } from "./linux-stdin-fifo";
import type { SubprocessRunner } from "../types";

describe("shouldUseLinuxStdinFifo", () => {
  const originalPlatform = process.platform;
  const originalJestId = process.env.JEST_WORKER_ID;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    if (originalJestId === undefined) delete process.env.JEST_WORKER_ID;
    else process.env.JEST_WORKER_ID = originalJestId;
  });

  it("returns false on non-linux platforms", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    delete process.env.JEST_WORKER_ID;
    expect(shouldUseLinuxStdinFifo()).toBe(false);
  });

  it("returns false on linux when JEST_WORKER_ID is set (unit-test context)", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.JEST_WORKER_ID = "1";
    expect(shouldUseLinuxStdinFifo()).toBe(false);
  });

  it("returns true on linux without JEST_WORKER_ID", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    delete process.env.JEST_WORKER_ID;
    expect(shouldUseLinuxStdinFifo()).toBe(true);
  });
});

describe("wrapWithLinuxStdinFifo", () => {
  // The unit-test environment always has JEST_WORKER_ID set, so the
  // wrapper short-circuits to passthrough on every platform here. Verify
  // the passthrough contract — the FIFO branch is exercised by the CDK
  // and UI integration tests on Linux CI.

  it("returns the input runner unchanged when the FIFO gate is closed", () => {
    const runner: SubprocessRunner = { run: jest.fn() };
    const wrapped = wrapWithLinuxStdinFifo(runner);
    expect(wrapped).toBe(runner);
  });

  it("forwards calls to the underlying runner verbatim in passthrough mode", async () => {
    const run = jest.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    const wrapped = wrapWithLinuxStdinFifo({ run });
    await wrapped.run("sops", ["decrypt", "/dev/stdin"], { stdin: "blob" });
    expect(run).toHaveBeenCalledWith("sops", ["decrypt", "/dev/stdin"], { stdin: "blob" });
  });
});
