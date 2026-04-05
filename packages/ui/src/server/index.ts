import * as fs from "fs";
import * as path from "path";
import { extname } from "path";
import { randomBytes, timingSafeEqual } from "crypto";
import express, { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
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
  getAsset(key: string): ArrayBuffer;
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
function mountSeaStaticRoutes(
  app: ReturnType<typeof express>,
  sea: SeaModule,
  limiter: ReturnType<typeof rateLimit>,
): void {
  const serveAsset = (key: string, res: Response, next: NextFunction): void => {
    try {
      const buf = Buffer.from(sea.getAsset(key));
      res.setHeader("Content-Type", mimeFor(key));
      res.setHeader("Content-Length", buf.length);
      res.end(buf);
    } catch {
      next();
    }
  };

  // Serve any request whose path maps to a known asset key
  app.use(limiter, (req: Request, res: Response, next: NextFunction) => {
    const reqPath = req.path === "/" ? "/index.html" : req.path;
    const key = `client${reqPath}`;
    serveAsset(key, res, next);
  });

  // SPA fallback — anything unmatched gets index.html
  app.get("/{*splat}", limiter, (_req: Request, res: Response, next: NextFunction) => {
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

  // Host header validation — block DNS rebinding attacks.
  // Applied to all routes (not just /api) to prevent probing via /_runtime or static assets.
  app.use((req: Request, res: Response, next: NextFunction) => {
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
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const provided = Buffer.from(token);
    const expected = Buffer.from(sessionToken);
    if (!token || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
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

  // Rate-limit static asset serving. This server binds to 127.0.0.1 only, so
  // the limit is generous — it exists solely to satisfy the DoS-prevention
  // requirement and will not affect normal interactive use.
  const staticLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 1000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  // Serve static client files.
  // Priority: SEA blob > explicit clientDir > default path relative to this file.
  //
  // SEA assets are tried first when running as a single executable.  The disk
  // fallback is always mounted afterwards so that:
  //   • non-SEA runs (dev, test, npm-linked installs) work out of the box, and
  //   • SEA runs where getAsset() is unavailable (e.g. Node.js versions that
  //     don't support the assets API) gracefully fall back to dist/client/ on
  //     disk rather than returning 404 for every static request.
  const sea = getSea();
  const isSeaBinary = !!sea?.isSea();

  // Expose runtime info so E2E tests can verify SEA asset serving is active.
  // Mounted outside /api to avoid auth — this is read-only, no secrets exposed.
  app.get("/_runtime", (_req: Request, res: Response) => {
    res.json({ sea: isSeaBinary });
  });

  if (isSeaBinary) {
    mountSeaStaticRoutes(app, sea!, staticLimiter);
  }

  // Disk fallback — only when NOT running as a SEA binary (dev, test,
  // npm-linked installs).  SEA binaries serve everything from the embedded
  // blob via mountSeaStaticRoutes above; the disk path doesn't exist.
  if (!isSeaBinary) {
    let resolvedClientDir = clientDir ?? path.resolve(__dirname, "../client");

    // When the server code is inlined into another bundle (e.g. CLI via esbuild),
    // __dirname points to the host bundle's dist dir, not @clef-sh/ui's.
    // Fall back to resolving the package location at runtime.
    if (!clientDir && !fs.existsSync(path.join(resolvedClientDir, "index.html"))) {
      try {
        // Dynamic string hides the specifier from esbuild's static analyzer
        const uiPkg = require.resolve(`${"@clef-sh/ui"}/package.json`);
        resolvedClientDir = path.join(path.dirname(uiPkg), "dist", "client");
      } catch {
        // Keep the __dirname fallback
      }
    }
    app.use(staticLimiter, express.static(resolvedClientDir));

    // SPA fallback — serve index.html for non-API routes.
    // Use { root } so the send package's dotfile check applies only to the
    // relative filename ("index.html") and not the full absolute path, which
    // can include dotfile directories such as ~/.nvm or ~/.local.
    app.get("/{*splat}", staticLimiter, (_req, res) => {
      res.sendFile("index.html", { root: resolvedClientDir });
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
