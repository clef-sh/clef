import * as fs from "fs";
import * as os from "os";
import { startServer, ServerHandle } from "../../packages/ui/src/server";
import { generateAgeKey, checkSopsAvailable, AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, TestRepo } from "../setup/repo";

function getLocalNetworkIP(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

describe("Server binding", () => {
  let server: ServerHandle;
  let keys: AgeKeyPair;
  let repo: TestRepo;

  beforeAll(async () => {
    checkSopsAvailable();
    try {
      keys = await generateAgeKey();
      repo = scaffoldTestRepo(keys);
    } catch (err) {
      repo?.cleanup();
      throw err;
    }
    server = await startServer(0, repo.dir);
  });

  afterAll(async () => {
    try {
      await server?.stop();
    } catch {
      // Best effort cleanup
    } finally {
      try {
        repo?.cleanup();
      } finally {
        if (keys?.tmpDir) {
          try {
            fs.rmSync(keys.tmpDir, { recursive: true, force: true });
          } catch {
            // Ignore
          }
        }
      }
    }
  });

  it("binds to 127.0.0.1 only", () => {
    const addr = server.address();
    expect(addr.address).toBe("127.0.0.1");
  });

  it("refuses connections on non-loopback interface", async () => {
    const nonLoopbackIP = getLocalNetworkIP();
    if (!nonLoopbackIP) {
      // No non-loopback network interface available (common in headless CI containers)
      return;
    }
    const addr = server.address();
    await expect(fetch(`http://${nonLoopbackIP}:${addr.port}/api/manifest`)).rejects.toThrow();
  });

  it("server address is unconditionally 127.0.0.1", () => {
    // This test always runs, even in headless CI containers without a
    // non-loopback interface, guaranteeing the binding assertion is never skipped.
    const addr = server.address();
    expect(addr.address).toBe("127.0.0.1");
    expect(addr.address).not.toBe("0.0.0.0");
    expect(addr.address).not.toBe("::");
  });
});
