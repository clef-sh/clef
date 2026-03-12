import * as path from "path";
import { randomBytes } from "crypto";
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

export async function startServer(
  port: number,
  repoRoot: string,
  runner?: SubprocessRunner,
): Promise<ServerHandle> {
  const app = express();
  const sessionToken = randomBytes(32).toString("hex");

  app.use(express.json());

  // Host header validation — block DNS rebinding attacks
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host ?? "";
    const actualPort = (req.socket.address() as { port?: number })?.port ?? port;
    const allowedHosts = [`127.0.0.1:${actualPort}`, `127.0.0.1:${port}`, "127.0.0.1"];
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
    if (!match || match[1] !== sessionToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // Mount API routes
  if (runner) {
    const apiRouter = createApiRouter({ runner, repoRoot });
    app.use("/api", apiRouter);
  }

  // Serve static client files
  const clientDir = path.resolve(__dirname, "../client");
  app.use(express.static(clientDir));

  // SPA fallback — serve index.html for non-API routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });

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
