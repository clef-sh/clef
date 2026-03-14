import * as path from "path";
import { extname } from "path";
import { randomBytes, timingSafeEqual } from "crypto";
import express, { Request, Response, NextFunction } from "express";
import { Server } from "http";
import { SubprocessRunner } from "@clef-sh/core";
import { createApiRouter } from "./api";

export interface ServerHandle {
  url: string;
  token: string;
  stop: () => Promise<void>;
  address: () => { address: string; port: number };
}

// ── SEA (Single Executable Application) helpers ───────────────────────────────

// node:sea is available in Node 20+.  When running as a plain npm package the
// module still exists but isSea() returns false.  Wrap in try/catch for Node 18.
interface SeaModule {
  isSea(): boolean;
  getAsset(key: string, encoding: "buffer"): ArrayBuffer;
}

function getSea(): SeaModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("node:sea") as SeaModule;
  } catch {
    return null;
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function mimeFor(filePath: string): string {
  return MIME[extname(filePath)] ?? "application/octet-stream";
}

// Register express routes that serve static assets from the embedded SEA blob.
// Assets are keyed by their path relative to the dist/ root, e.g.
// "client/index.html", "client/assets/index-abc123.js".
function mountSeaStaticRoutes(app: ReturnType<typeof express>, sea: SeaModule): void {
  const serveAsset = (key: string, res: Response, next: NextFunction): void => {
    try {
      const buf = Buffer.from(sea.getAsset(key, "buffer"));
      res.setHeader("Content-Type", mimeFor(key));
      res.setHeader("Content-Length", buf.length);
      res.end(buf);
    } catch {
      next();
    }
  };

  // Serve any request whose path maps to a known asset key
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqPath = req.path === "/" ? "/index.html" : req.path;
    const key = `client${reqPath}`;
    serveAsset(key, res, next);
  });

  // SPA fallback — anything unmatched gets index.html
  app.get("*", (_req: Request, res: Response, next: NextFunction) => {
    serveAsset("client/index.html", res, next);
  });
}

// ── Server ────────────────────────────────────────────────────────────────────

export async function startServer(
  port: number,
  repoRoot: string,
  runner?: SubprocessRunner,
  clientDir?: string,
  ageKeyFile?: string,
  ageKey?: string,
): Promise<ServerHandle> {
  const app = express();
  const sessionToken = randomBytes(32).toString("hex");

  app.use(express.json());

  // Host header validation — block DNS rebinding attacks
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host ?? "";
    const actualPort = (req.socket.address() as { port?: number })?.port ?? port;
    const allowedHosts = [`127.0.0.1:${actualPort}`, `127.0.0.1:${port}`];
    if (!allowedHosts.includes(host)) {
      res.status(403).json({ error: "Forbidden: invalid Host header" });
      return;
    }
    next();
  });

  // Bearer token authentication for all API routes
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization ?? "";
    const match = authHeader.match(/^Bearer\s+(.+)$/);
    const provided = Buffer.from(match ? match[1] : "");
    const expected = Buffer.from(sessionToken);
    if (!match || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // Mount API routes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dispose is dynamically attached
  let apiRouter: any;
  if (runner) {
    apiRouter = createApiRouter({ runner, repoRoot, ageKeyFile, ageKey });
    app.use("/api", apiRouter);
  }

  // Serve static client files.
  // Priority: SEA blob > explicit clientDir > default path relative to this file.
  const sea = getSea();
  if (sea?.isSea()) {
    mountSeaStaticRoutes(app, sea);
  } else {
    // When the CLI bundles this code with esbuild, all modules land in a single
    // dist/index.js, so __dirname resolves to that file's directory.  The caller
    // passes an explicit clientDir (dist/client/) to handle that case.
    // In standalone/dev use, the default path relative to this file works.
    const resolvedClientDir = clientDir ?? path.resolve(__dirname, "../client");
    app.use(express.static(resolvedClientDir));

    // SPA fallback — serve index.html for non-API routes
    app.get("*", (_req, res) => {
      res.sendFile(path.join(resolvedClientDir, "index.html"));
    });
  }

  const url = `http://127.0.0.1:${port}`;

  return new Promise<ServerHandle>((resolve, reject) => {
    let server: Server;
    try {
      server = app.listen(port, "127.0.0.1", () => {
        const handle: ServerHandle = {
          url,
          token: sessionToken,
          stop: () =>
            new Promise<void>((resolveStop, rejectStop) => {
              server.close((err) => {
                if (apiRouter?.dispose) {
                  apiRouter.dispose();
                }
                if (err) {
                  rejectStop(err);
                } else {
                  resolveStop();
                }
              });
            }),
          address: () => {
            const addr = server.address();
            if (typeof addr === "string" || !addr) {
              return { address: "127.0.0.1", port };
            }
            return { address: addr.address, port: addr.port };
          },
        };
        resolve(handle);
      });

      server.on("error", (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}
