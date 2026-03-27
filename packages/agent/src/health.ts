import { Request, Response } from "express";
import { SecretsCache } from "@clef-sh/runtime";
import type { EncryptedArtifactStore } from "@clef-sh/runtime";

/** Create health endpoint handler (unauthenticated). */
export function healthHandler(
  cache: SecretsCache,
  cacheTtl?: number,
  encryptedStore?: EncryptedArtifactStore,
) {
  return (_req: Request, res: Response): void => {
    if (encryptedStore) {
      // JIT mode: freshness is proved by KMS on each request, no TTL to expire
      res.json({
        status: "ok",
        mode: "jit",
        revision: encryptedStore.getRevision(),
        lastRefreshAt: encryptedStore.getStoredAt(),
        expired: false,
      });
    } else {
      const expired = cacheTtl !== undefined && cache.isExpired(cacheTtl);
      res.json({
        status: "ok",
        mode: "cached",
        revision: cache.getRevision(),
        lastRefreshAt: cache.getSwappedAt(),
        expired,
      });
    }
  };
}

/** Create readiness endpoint handler (unauthenticated). */
export function readyHandler(
  cache: SecretsCache,
  cacheTtl?: number,
  encryptedStore?: EncryptedArtifactStore,
) {
  return (_req: Request, res: Response): void => {
    if (encryptedStore) {
      // JIT mode: ready when encrypted artifact is loaded
      if (!encryptedStore.isReady()) {
        res.status(503).json({ ready: false, reason: "not_loaded" });
        return;
      }
      res.status(200).json({ ready: true });
    } else {
      if (!cache.isReady()) {
        res.status(503).json({ ready: false, reason: "not_loaded" });
        return;
      }
      if (cacheTtl !== undefined && cache.isExpired(cacheTtl)) {
        res.status(503).json({ ready: false, reason: "cache_expired" });
        return;
      }
      res.status(200).json({ ready: true });
    }
  };
}
