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
    }
    repo?.cleanup();
    if (keys?.tmpDir) {
      try {
        fs.rmSync(keys.tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
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
      // Skip gracefully in headless CI containers with no network interfaces
      // eslint-disable-next-line no-console
      console.log("Skipping: no non-loopback network interface found");
      return;
    }
    const addr = server.address();
    await expect(fetch(`http://${nonLoopbackIP}:${addr.port}/api/manifest`)).rejects.toThrow();
  });
});
