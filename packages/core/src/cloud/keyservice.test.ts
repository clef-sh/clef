import { EventEmitter } from "events";
import { Readable } from "stream";
import { spawnKeyservice } from "./keyservice";

// Mock child_process.spawn
jest.mock("child_process", () => ({
  spawn: jest.fn(),
}));

import { spawn } from "child_process";

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockChild(): EventEmitter & {
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null;
  kill: jest.Mock;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    exitCode: number | null;
    kill: jest.Mock;
  };
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.exitCode = null;
  child.kill = jest.fn();
  return child;
}

describe("spawnKeyservice", () => {
  it("should resolve with correct addr when PORT= is printed", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/path/to/clef-keyservice",
      token: "test-token",
    });

    // Simulate the binary printing its port
    child.stdout.push("PORT=12345\n");

    const handle = await promise;

    expect(handle.addr).toBe("tcp://127.0.0.1:12345");
    expect(mockSpawn).toHaveBeenCalledWith(
      "/path/to/clef-keyservice",
      ["--addr", "127.0.0.1:0"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        env: expect.objectContaining({ CLEF_CLOUD_TOKEN: "test-token" }),
      }),
    );
  });

  it("should pass endpoint when specified", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/path/to/clef-keyservice",
      token: "test-token",
      endpoint: "https://custom.api",
    });

    child.stdout.push("PORT=9999\n");
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      "/path/to/clef-keyservice",
      ["--addr", "127.0.0.1:0", "--endpoint", "https://custom.api"],
      expect.anything(),
    );
  });

  it("should reject when process exits unexpectedly", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/path/to/clef-keyservice",
      token: "test-token",
    });

    child.emit("exit", 1);

    await expect(promise).rejects.toThrow("exited unexpectedly with code 1");
  });

  it("should reject when process emits error", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/path/to/clef-keyservice",
      token: "test-token",
    });

    child.emit("error", new Error("ENOENT"));

    await expect(promise).rejects.toThrow("Failed to start keyservice: ENOENT");
  });

  it("should kill the process via SIGTERM on handle.kill()", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/path/to/clef-keyservice",
      token: "test-token",
    });

    child.stdout.push("PORT=12345\n");
    const handle = await promise;

    const killPromise = handle.kill();
    // Simulate process exiting after SIGTERM
    child.emit("exit", 0);
    child.exitCode = 0;

    await killPromise;

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("should resolve immediately if process already exited", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/path/to/clef-keyservice",
      token: "test-token",
    });

    child.stdout.push("PORT=12345\n");
    const handle = await promise;

    // Simulate already exited
    child.exitCode = 0;

    await handle.kill(); // Should resolve without calling kill
  });
});
