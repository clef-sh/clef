import { EventEmitter } from "events";
import { Readable } from "stream";
import { spawn } from "child_process";
import { spawnKeyservice } from "./keyservice";

jest.mock("child_process", () => ({ spawn: jest.fn() }));
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null;
  kill: jest.Mock;
}

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.exitCode = null;
  child.kill = jest.fn(() => {
    child.exitCode = 0;
    setImmediate(() => child.emit("exit", 0, null));
    return true;
  });
  return child;
}

describe("spawnKeyservice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects when neither pin nor pinFile is provided", async () => {
    await expect(
      spawnKeyservice({
        binaryPath: "/bin/clef-keyservice",
        modulePath: "/lib/softhsm.so",
      }),
    ).rejects.toThrow(/PIN/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("spawns the binary with --pkcs11-module on argv and PIN in env", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/bin/clef-keyservice",
      modulePath: "/lib/softhsm.so",
      pin: "1234",
    });

    // Drive port discovery
    setImmediate(() => child.stdout.push("PORT=54321\n"));

    const handle = await promise;
    expect(handle.addr).toBe("tcp://127.0.0.1:54321");

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = mockSpawn.mock.calls[0];
    expect(bin).toBe("/bin/clef-keyservice");
    expect(args).toEqual(["--addr", "127.0.0.1:0", "--pkcs11-module", "/lib/softhsm.so"]);
    // PIN must NOT appear on argv (process command lines are world-readable)
    expect((args as string[]).join(" ")).not.toContain("1234");
    // PIN MUST appear in env
    const env = (opts as { env: NodeJS.ProcessEnv }).env;
    expect(env.CLEF_PKCS11_PIN).toBe("1234");
  });

  it("forwards CLEF_PKCS11_PIN_FILE for pin-file flow", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/bin/clef-keyservice",
      modulePath: "/lib/softhsm.so",
      pinFile: "/etc/keys/pin",
    });
    setImmediate(() => child.stdout.push("PORT=11111\n"));

    await promise;
    const [, , opts] = mockSpawn.mock.calls[0];
    const env = (opts as { env: NodeJS.ProcessEnv }).env;
    expect(env.CLEF_PKCS11_PIN_FILE).toBe("/etc/keys/pin");
    expect(env.CLEF_PKCS11_PIN).toBeUndefined();
  });

  it("forwards extra env (vendor module config)", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/bin/clef-keyservice",
      modulePath: "/lib/softhsm.so",
      pin: "1234",
      extraEnv: { SOFTHSM2_CONF: "/tmp/softhsm2.conf" },
    });
    setImmediate(() => child.stdout.push("PORT=22222\n"));

    await promise;
    const [, , opts] = mockSpawn.mock.calls[0];
    const env = (opts as { env: NodeJS.ProcessEnv }).env;
    expect(env.SOFTHSM2_CONF).toBe("/tmp/softhsm2.conf");
    // PIN still wins over any conflicting extra
    expect(env.CLEF_PKCS11_PIN).toBe("1234");
  });

  it("rejects when child exits before reporting PORT=", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/bin/clef-keyservice",
      modulePath: "/lib/softhsm.so",
      pin: "1234",
    });
    setImmediate(() => child.emit("exit", 1, null));

    await expect(promise).rejects.toThrow(/exited with code 1/);
  });

  it("rejects when spawn emits an error", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/bin/missing",
      modulePath: "/lib/softhsm.so",
      pin: "1234",
    });
    setImmediate(() => child.emit("error", new Error("ENOENT")));

    await expect(promise).rejects.toThrow(/Failed to start clef-keyservice.*ENOENT/);
  });

  it("kill() sends SIGTERM and resolves on exit", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/bin/clef-keyservice",
      modulePath: "/lib/softhsm.so",
      pin: "1234",
    });
    setImmediate(() => child.stdout.push("PORT=33333\n"));
    const handle = await promise;

    await handle.kill();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("kill() resolves immediately if child already exited", async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/bin/clef-keyservice",
      modulePath: "/lib/softhsm.so",
      pin: "1234",
    });
    setImmediate(() => child.stdout.push("PORT=44444\n"));
    const handle = await promise;

    child.exitCode = 0;
    await handle.kill();
    // Only the optional escalation kill — no SIGTERM expected since exitCode was set
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("times out if child never reports PORT= within startup window", async () => {
    jest.useFakeTimers();
    const child = makeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const promise = spawnKeyservice({
      binaryPath: "/bin/clef-keyservice",
      modulePath: "/lib/softhsm.so",
      pin: "1234",
    });

    jest.advanceTimersByTime(5001);
    await expect(promise).rejects.toThrow(/did not report a port/);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    jest.useRealTimers();
  });
});
