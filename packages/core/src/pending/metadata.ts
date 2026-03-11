/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * This module requires exhaustive test coverage. Before
 * adding or modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as YAML from "yaml";

interface PendingKey {
  key: string;
  since: Date;
  setBy: string;
}

interface PendingMetadata {
  version: 1;
  pending: PendingKey[];
}

// Derive .clef-meta.yaml path from .enc.yaml path
// database/dev.enc.yaml → database/dev.clef-meta.yaml
function metadataPath(encryptedFilePath: string): string {
  const dir = path.dirname(encryptedFilePath);
  const base = path.basename(encryptedFilePath, ".enc.yaml");
  return path.join(dir, `${base}.clef-meta.yaml`);
}

const HEADER_COMMENT = "# Managed by Clef. Do not edit manually.\n";

async function loadMetadata(filePath: string): Promise<PendingMetadata> {
  const metaPath = metadataPath(filePath);
  try {
    if (!fs.existsSync(metaPath)) {
      return { version: 1, pending: [] };
    }
    const content = fs.readFileSync(metaPath, "utf-8");
    const parsed = YAML.parse(content);
    if (!parsed || !Array.isArray(parsed.pending)) {
      return { version: 1, pending: [] };
    }
    return {
      version: 1,
      pending: parsed.pending.map((p: { key: string; since: string; setBy: string }) => ({
        key: p.key,
        since: new Date(p.since),
        setBy: p.setBy,
      })),
    };
  } catch {
    return { version: 1, pending: [] };
  }
}

async function saveMetadata(filePath: string, metadata: PendingMetadata): Promise<void> {
  const metaPath = metadataPath(filePath);
  const dir = path.dirname(metaPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data = {
    version: metadata.version,
    pending: metadata.pending.map((p) => ({
      key: p.key,
      since: p.since.toISOString(),
      setBy: p.setBy,
    })),
  };
  fs.writeFileSync(metaPath, HEADER_COMMENT + YAML.stringify(data), "utf-8");
}

async function markPending(filePath: string, keys: string[], setBy: string): Promise<void> {
  const metadata = await loadMetadata(filePath);
  const now = new Date();
  for (const key of keys) {
    const existing = metadata.pending.findIndex((p) => p.key === key);
    if (existing >= 0) {
      // Upsert: update timestamp and setBy on re-randomization
      metadata.pending[existing] = { key, since: now, setBy };
    } else {
      metadata.pending.push({ key, since: now, setBy });
    }
  }
  await saveMetadata(filePath, metadata);
}

async function markResolved(filePath: string, keys: string[]): Promise<void> {
  const metadata = await loadMetadata(filePath);
  metadata.pending = metadata.pending.filter((p) => !keys.includes(p.key));
  await saveMetadata(filePath, metadata);
}

async function getPendingKeys(filePath: string): Promise<string[]> {
  const metadata = await loadMetadata(filePath);
  return metadata.pending.map((p) => p.key);
}

async function isPending(filePath: string, key: string): Promise<boolean> {
  const metadata = await loadMetadata(filePath);
  return metadata.pending.some((p) => p.key === key);
}

function generateRandomValue(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function markPendingWithRetry(
  filePath: string,
  keys: string[],
  setBy: string,
  retryDelayMs = 200,
): Promise<void> {
  try {
    await markPending(filePath, keys, setBy);
  } catch {
    // One retry after short delay for transient failures
    await new Promise((r) => setTimeout(r, retryDelayMs));
    await markPending(filePath, keys, setBy);
  }
}

export {
  PendingKey,
  PendingMetadata,
  metadataPath,
  loadMetadata,
  saveMetadata,
  markPending,
  markPendingWithRetry,
  markResolved,
  getPendingKeys,
  isPending,
  generateRandomValue,
};
