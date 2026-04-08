import { PostHog } from "posthog-node";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as YAML from "yaml";

const POSTHOG_API_KEY = "phc_9ABRW4XA81c8HiBkam8qURqCgD61fw7Zjn5vWkbFUvp";
const POSTHOG_HOST = "https://us.i.posthog.com";
const SHUTDOWN_TIMEOUT_MS = 500;

let client: PostHog | null = null;
let disabled = false;

/**
 * Check if analytics is disabled via env var or config file.
 *
 * Opt-out paths:
 *   - CLEF_ANALYTICS=0 (env var, session-scoped)
 *   - analytics: false in ~/.clef/config.yaml (persistent)
 */
function isOptedOut(): boolean {
  // Env var takes precedence
  const envVal = process.env.CLEF_ANALYTICS;
  if (envVal === "0" || envVal === "false") return true;

  // Check persistent config
  try {
    const configPath = path.join(os.homedir(), ".clef", "config.yaml");
    const raw = YAML.parse(fs.readFileSync(configPath, "utf-8"));
    if (raw && typeof raw === "object" && (raw as Record<string, unknown>).analytics === false) {
      return true;
    }
  } catch {
    // No config file or unreadable — analytics stays on
  }

  return false;
}

function getOrCreateClient(): PostHog | null {
  if (disabled) return null;

  if (!client) {
    if (isOptedOut()) {
      disabled = true;
      return null;
    }

    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }

  return client;
}

/**
 * Generate a stable anonymous ID for this machine.
 * Uses hostname + os.userInfo().uid hashed to avoid PII.
 */
function getAnonymousId(): string {
  const raw = `${os.hostname()}-${os.userInfo().uid}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Track a CLI event. No-op if analytics is disabled or package is unavailable.
 *
 * Never tracks: secret values, file paths, repo names, or any content.
 * Only tracks: command name, duration, success/failure, CLI version, OS/arch.
 */
export function track(event: string, properties?: Record<string, string | number | boolean>): void {
  const ph = getOrCreateClient();
  if (!ph) return;

  ph.capture({
    distinctId: getAnonymousId(),
    event,
    properties: {
      ...properties,
      os: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
  });
}

/**
 * Flush all pending events and shut down the PostHog client.
 * Must be called before process exit or events are lost.
 */
export async function shutdown(): Promise<void> {
  if (!client) return;

  try {
    await client.shutdown(SHUTDOWN_TIMEOUT_MS);
  } catch {
    // Never let analytics block process exit
  } finally {
    client = null;
  }
}

/**
 * Returns true if analytics is currently disabled.
 */
export function isDisabled(): boolean {
  if (disabled) return true;
  if (isOptedOut()) {
    disabled = true;
    return true;
  }
  return false;
}
