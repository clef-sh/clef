import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { ClefLocalConfig, SopsClient, SubprocessRunner } from "@clef-sh/core";
import { getKeychainKey } from "./keychain";

const CLEF_DIR = ".clef";
const CLEF_CONFIG_FILENAME = "config.yaml";

/**
 * The resolved source of an age private key credential.
 *
 * - keychain     — retrieved from the OS keychain (macOS/Linux); privateKey is the inline value
 * - env-key      — CLEF_AGE_KEY is set in the environment
 * - env-file     — CLEF_AGE_KEY_FILE is set in the environment
 * - config-file  — path read from .clef/config.yaml age_key_file
 */
export type AgeCredential =
  | { source: "keychain"; privateKey: string }
  | { source: "env-key" }
  | { source: "env-file" }
  | { source: "config-file"; path: string };

/**
 * Resolve the age private key credential from available sources in priority order:
 *   1. OS keychain (macOS Keychain / Linux libsecret / Windows Credential Manager)
 *      — requires a label from .clef/config.yaml; skipped if no label is configured
 *   2. CLEF_AGE_KEY env var (inline key)
 *   3. CLEF_AGE_KEY_FILE env var (file path)
 *   4. .clef/config.yaml age_key_file
 *
 * Returns null if no credential is found from any source.
 */
export async function resolveAgeCredential(
  repoRoot: string,
  runner: SubprocessRunner,
): Promise<AgeCredential | null> {
  // Read label from config for keychain lookup
  const config = readLocalConfig(repoRoot);
  const label = config?.age_keychain_label;

  // 1. OS keychain — only if a label is configured
  if (label) {
    const keychainKey = await getKeychainKey(runner, label);
    if (keychainKey) return { source: "keychain", privateKey: keychainKey };
  }

  // 2. CLEF_AGE_KEY env var (inline key)
  if (process.env.CLEF_AGE_KEY) return { source: "env-key" };

  // 3. CLEF_AGE_KEY_FILE env var
  if (process.env.CLEF_AGE_KEY_FILE) return { source: "env-file" };

  // 4. .clef/config.yaml age_key_file
  if (config?.age_key_file) {
    return { source: "config-file", path: config.age_key_file };
  }

  return null;
}

/**
 * Read the `age_key_storage` field from `.clef/config.yaml`.
 * Returns "keychain" or "file" if set, undefined otherwise.
 *
 * Callers use this to give targeted guidance when `resolveAgeCredential` returns null —
 * for example, "your key was stored in the OS keychain during init but the keychain
 * is not available on this system."
 */
export function getExpectedKeyStorage(repoRoot: string): "keychain" | "file" | undefined {
  const config = readLocalConfig(repoRoot);
  return config?.age_key_storage;
}

/**
 * Read the `age_keychain_label` from `.clef/config.yaml`.
 * Returns the label string if set, undefined otherwise.
 */
export function getExpectedKeyLabel(repoRoot: string): string | undefined {
  const config = readLocalConfig(repoRoot);
  return config?.age_keychain_label;
}

/**
 * Prepare the SopsClient constructor arguments from a resolved credential.
 *
 * Returns `{ ageKeyFile, ageKey }` — one or both may be undefined. These values
 * are passed directly to the SopsClient constructor, which injects them into the
 * subprocess environment. This avoids mutating `process.env` and prevents leakage
 * of SOPS_AGE_KEY / SOPS_AGE_KEY_FILE from Clef into the parent process.
 */
export function prepareSopsClientArgs(credential: AgeCredential | null): {
  ageKeyFile?: string;
  ageKey?: string;
} {
  if (!credential) return {};
  switch (credential.source) {
    case "keychain":
      return { ageKey: credential.privateKey };
    case "env-key":
      return { ageKey: process.env.CLEF_AGE_KEY };
    case "env-file":
      return { ageKeyFile: process.env.CLEF_AGE_KEY_FILE };
    case "config-file":
      return { ageKeyFile: credential.path };
  }
}

/**
 * Resolve credentials and create a SopsClient in one step.
 * Convenience wrapper used by most CLI commands.
 */
export async function createSopsClient(
  repoRoot: string,
  runner: SubprocessRunner,
): Promise<SopsClient> {
  const credential = await resolveAgeCredential(repoRoot, runner);
  const { ageKeyFile, ageKey } = prepareSopsClientArgs(credential);
  return new SopsClient(runner, ageKeyFile, ageKey);
}

const AGE_SECRET_KEY_RE = /^(AGE-SECRET-KEY-\S+)/m;

/**
 * Resolve the raw age private key string from the best available source.
 * Used by `clef recipients request` to derive the public key.
 */
export async function resolveAgePrivateKey(
  repoRoot: string,
  runner: SubprocessRunner,
): Promise<string | null> {
  const credential = await resolveAgeCredential(repoRoot, runner);
  if (!credential) return null;

  switch (credential.source) {
    case "keychain":
      return credential.privateKey;
    case "env-key": {
      const envKey = process.env.CLEF_AGE_KEY ?? "";
      const match = envKey.match(AGE_SECRET_KEY_RE);
      return match ? match[1] : envKey.trim() || null;
    }
    case "env-file": {
      const filePath = process.env.CLEF_AGE_KEY_FILE;
      if (!filePath) return null;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const match = content.match(AGE_SECRET_KEY_RE);
        return match ? match[1] : null;
      } catch {
        return null;
      }
    }
    case "config-file": {
      try {
        const content = fs.readFileSync(credential.path, "utf-8");
        const match = content.match(AGE_SECRET_KEY_RE);
        return match ? match[1] : null;
      } catch {
        return null;
      }
    }
  }
}

/** Read and parse .clef/config.yaml, returning null on any failure. */
function readLocalConfig(repoRoot: string): ClefLocalConfig | null {
  const clefConfigPath = path.join(repoRoot, CLEF_DIR, CLEF_CONFIG_FILENAME);
  try {
    if (!fs.existsSync(clefConfigPath)) return null;
    return YAML.parse(fs.readFileSync(clefConfigPath, "utf-8")) as ClefLocalConfig;
  } catch {
    return null;
  }
}
