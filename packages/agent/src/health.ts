import { Request, Response } from "express";
import { SecretsCache } from "@clef-sh/runtime";

/** Create health endpoint handler (unauthenticated). */
export function healthHandler(cache: SecretsCache) {
  return (_req: Request, res: Response): void => {
    res.json({
      status: "ok",
      revision: cache.getRevision(),
    });
  };
}

/** Create readiness endpoint handler (unauthenticated). */
export function readyHandler(cache: SecretsCache) {
  return (_req: Request, res: Response): void => {
    if (cache.isReady()) {
      res.status(200).json({ ready: true });
    } else {
      res.status(503).json({ ready: false });
    }
  };
}
