import { timingSafeEqual } from "crypto";
import express, { Request, Response, NextFunction } from "express";
import { Server } from "http";
import type { AddressInfo } from "net";
import { SecretsCache } from "./cache";
import { healthHandler, readyHandler } from "./health";

export interface AgentServerHandle {
  url: string;
  stop: () => Promise<void>;
  address: () => AddressInfo | string | null;
}

export interface AgentServerOptions {
  port: number;
  token: string;
  cache: SecretsCache;
}

/**
 * Start the agent HTTP API server on 127.0.0.1.
 *
 * Routes:
 *   GET /v1/secrets       → all secrets (authenticated)
 *   GET /v1/secrets/:key  → single secret (authenticated)
 *   GET /v1/keys          → key names (authenticated)
 *   GET /v1/health        → health check (unauthenticated)
 *   GET /v1/ready         → readiness probe (unauthenticated)
 */
export function startAgentServer(options: AgentServerOptions): Promise<AgentServerHandle> {
  const { port, token, cache } = options;
  const app = express();

  app.use(express.json());

  // Host header validation — block DNS rebinding attacks
  app.use("/v1", (req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host ?? "";
    const actualPort = (req.socket.address() as { port?: number })?.port ?? port;
    const allowedHosts = [`127.0.0.1:${actualPort}`, `127.0.0.1:${port}`, "127.0.0.1"];
    if (!allowedHosts.includes(host)) {
      res.status(403).json({ error: "Forbidden: invalid Host header" });
      return;
    }
    next();
  });

  // Prevent intermediary caches from storing decrypted secret values
  app.use("/v1/secrets", (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Unauthenticated endpoints — must be mounted before the auth middleware
  app.get("/v1/health", healthHandler(cache));
  app.get("/v1/ready", readyHandler(cache));

  // Bearer token authentication for secrets endpoints
  app.use("/v1/secrets", authMiddleware(token));
  app.use("/v1/keys", authMiddleware(token));

  // GET /v1/secrets — all secrets
  app.get("/v1/secrets", (_req: Request, res: Response) => {
    const all = cache.getAll();
    if (!all) {
      res.status(503).json({ error: "Secrets not yet loaded" });
      return;
    }
    res.json(all);
  });

  // GET /v1/secrets/:key — single secret
  app.get("/v1/secrets/:key", (req: Request<{ key: string }>, res: Response) => {
    const value = cache.get(req.params.key);
    if (value === undefined) {
      res.status(404).json({ error: `Secret '${req.params.key}' not found` });
      return;
    }
    res.json({ value });
  });

  // GET /v1/keys — list key names
  app.get("/v1/keys", (_req: Request, res: Response) => {
    res.json(cache.getKeys());
  });

  const url = `http://127.0.0.1:${port}`;

  return new Promise<AgentServerHandle>((resolve, reject) => {
    let server: Server;
    try {
      server = app.listen(port, "127.0.0.1", () => {
        resolve({
          url,
          stop: () =>
            new Promise<void>((resolveStop, rejectStop) => {
              server.close((err) => (err ? rejectStop(err) : resolveStop()));
            }),
          address: () => server.address(),
        });
      });

      server.on("error", (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

function authMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization ?? "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(token);
    if (
      !provided ||
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
