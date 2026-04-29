import request from "supertest";
import * as fs from "fs";
import * as YAML from "yaml";
import { startServer, ServerHandle } from "./index";
import { SubprocessRunner } from "@clef-sh/core";

jest.mock("fs");

const mockFs = fs as jest.Mocked<typeof fs>;

const validManifestYaml = YAML.stringify({
  version: 1,
  environments: [{ name: "dev", description: "Dev" }],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
});

const sopsFileContent = YAML.stringify({
  sops: {
    age: [{ recipient: "age1abc" }],
    lastmodified: "2024-01-15T00:00:00Z",
  },
});

function makeRunner(): SubprocessRunner {
  return {
    run: jest.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "sops" && args[0] === "--version") {
        return { stdout: "sops 3.12.2 (latest)", stderr: "", exitCode: 0 };
      }
      if (cmd === "sops" && args[0] === "decrypt") {
        return {
          stdout: YAML.stringify({ DB_HOST: "localhost" }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (cmd === "sops" && args[0] === "filestatus") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      if (cmd === "cat") {
        return { stdout: sopsFileContent, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  };
}

describe("Server authentication", () => {
  let handle: ServerHandle;

  beforeAll(async () => {
    mockFs.readFileSync.mockReturnValue(validManifestYaml);
    mockFs.existsSync.mockReturnValue(true);
    handle = await startServer(0, "/repo", makeRunner());
  });

  afterAll(async () => {
    await handle.stop();
  });

  it("returns 401 without token", async () => {
    const res = await request(`http://127.0.0.1:${handle.address().port}`)
      .get("/api/manifest")
      .set("Host", `127.0.0.1:${handle.address().port}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("returns 401 with wrong token", async () => {
    const res = await request(`http://127.0.0.1:${handle.address().port}`)
      .get("/api/manifest")
      .set("Host", `127.0.0.1:${handle.address().port}`)
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("returns 200 with correct token", async () => {
    const res = await request(`http://127.0.0.1:${handle.address().port}`)
      .get("/api/manifest")
      .set("Host", `127.0.0.1:${handle.address().port}`)
      .set("Authorization", `Bearer ${handle.token}`);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
  });

  it("returns 403 when Host header does not match 127.0.0.1", async () => {
    const res = await request(`http://127.0.0.1:${handle.address().port}`)
      .get("/api/manifest")
      .set("Host", "evil.example.com")
      .set("Authorization", `Bearer ${handle.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Forbidden");
  });

  it("generates a 64-character hex token", () => {
    expect(handle.token).toMatch(/^[0-9a-f]{64}$/);
  });
});
