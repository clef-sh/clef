import { timingSafeEqual } from "crypto";
import express, { Request, Response, NextFunction } from "express";
import { Server } from "http";
import type { AddressInfo } from "net";
import { SecretsCache } from "@clef-sh/runtime";
import type { ArtifactDecryptor, EncryptedArtifactStore } from "@clef-sh/runtime";
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
  cacheTtl?: number;
  /** JIT mode: decrypt on every request instead of serving from cache. */
  decryptor?: ArtifactDecryptor;
  /** JIT mode: encrypted artifact store (required when decryptor is set). */
  encryptedStore?: EncryptedArtifactStore;
}

/**
 * Start the agent HTTP API server on 127.0.0.1.
 *
 * Routes:
 *   GET /v1/secrets       → all secrets (authenticated)
 *   GET /v1/keys          → key names (authenticated)
 *   GET /v1/health        → health check (unauthenticated)
 *   GET /v1/ready         → readiness probe (unauthenticated)
 */
export function startAgentServer(options: AgentServerOptions): Promise<AgentServerHandle> {
  const { port, token, cache, cacheTtl, decryptor, encryptedStore } = options;
  const jitMode = !!decryptor && !!encryptedStore;
  const app = express();

  // Host header validation — block DNS rebinding attacks.
  // Allowed hosts are static after startup; compute once.
  const allowedHosts = new Set([`127.0.0.1:${port}`, "127.0.0.1"]);
  app.use("/v1", (req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host ?? "";
    if (!allowedHosts.has(host)) {
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
  app.get("/v1/health", healthHandler(cache, cacheTtl, encryptedStore));
  app.get("/v1/ready", readyHandler(cache, cacheTtl, encryptedStore));

  // Bearer token authentication for secrets endpoints
  app.use("/v1/secrets", authMiddleware(token));
  app.use("/v1/keys", authMiddleware(token));

  // TTL guard — reject requests when cache has expired (cached mode only)
  // In JIT mode, freshness is proved by KMS success on each request.
  const ttlGuard = (_req: Request, res: Response, next: NextFunction): void => {
    if (jitMode) {
      if (!encryptedStore.isReady()) {
        res.status(503).json({ error: "Secrets not yet loaded" });
        return;
      }
    } else if (cacheTtl !== undefined && cache.isExpired(cacheTtl)) {
      res.status(503).json({ error: "Secrets expired" });
      return;
    }
    next();
  };
  app.use("/v1/secrets", ttlGuard);
  app.use("/v1/keys", ttlGuard);

  // GET /v1/secrets — all secrets
  app.get("/v1/secrets", async (_req: Request, res: Response) => {
    if (jitMode) {
      // JIT mode: decrypt on every request — KMS is the live authorization gate
      const artifact = encryptedStore.get();
      if (!artifact) {
        res.status(503).json({ error: "Secrets not yet loaded" });
        return;
      }
      try {
        const { values } = await decryptor.decrypt(artifact);
        res.json(values);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(503).json({ error: "Decryption failed", detail: message });
      }
    } else {
      // Cached mode: serve from in-memory cache
      const all = cache.getAll();
      if (!all) {
        res.status(503).json({ error: "Secrets not yet loaded" });
        return;
      }
      res.json(all);
    }
  });

  // GET /v1/keys — list key names (no decryption needed)
  app.get("/v1/keys", (_req: Request, res: Response) => {
    if (jitMode) {
      res.json(encryptedStore.getKeys());
    } else {
      res.json(cache.getKeys());
    }
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
              // Close idle connections immediately, then force-close active ones after 3s
              server.close((err) => (err ? rejectStop(err) : resolveStop()));
              const drainTimer = setTimeout(() => {
                server.closeAllConnections();
              }, 3000);
              drainTimer.unref();
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
  const expectedBuf = Buffer.from(token);
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization ?? "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const providedBuf = Buffer.from(provided);
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
