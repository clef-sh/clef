import { Request, Response } from "express";
import { SecretsCache } from "@clef-sh/runtime";

/** Create health endpoint handler (unauthenticated). */
export function healthHandler(cache: SecretsCache, cacheTtl?: number) {
  return (_req: Request, res: Response): void => {
    const expired = cacheTtl !== undefined && cache.isExpired(cacheTtl);
    res.json({
      status: "ok",
      revision: cache.getRevision(),
      lastRefreshAt: cache.getSwappedAt(),
      expired,
    });
  };
}

/** Create readiness endpoint handler (unauthenticated). */
export function readyHandler(cache: SecretsCache, cacheTtl?: number) {
  return (_req: Request, res: Response): void => {
    if (!cache.isReady()) {
      res.status(503).json({ ready: false, reason: "not_loaded" });
      return;
    }
    if (cacheTtl !== undefined && cache.isExpired(cacheTtl)) {
      res.status(503).json({ ready: false, reason: "cache_expired" });
      return;
    }
    res.status(200).json({ ready: true });
  };
}
