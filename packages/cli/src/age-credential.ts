import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { ClefLocalConfig, SubprocessRunner } from "@clef-sh/core";
import { getKeychainKey } from "./keychain";

const CLEF_DIR = ".clef";
const CLEF_CONFIG_FILENAME = "config.yaml";

/**
 * The resolved source of an age private key credential.
 *
 * - keychain     — retrieved from the OS keychain (macOS/Linux); privateKey is the inline value
 * - env-key      — SOPS_AGE_KEY is already set in the environment
 * - env-file     — SOPS_AGE_KEY_FILE is already set in the environment
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
 *   2. SOPS_AGE_KEY env var (inline key)
 *   3. SOPS_AGE_KEY_FILE env var (file path)
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

  // 2. SOPS_AGE_KEY env var (inline key already available to sops)
  if (process.env.SOPS_AGE_KEY) return { source: "env-key" };

  // 3. SOPS_AGE_KEY_FILE env var
  if (process.env.SOPS_AGE_KEY_FILE) return { source: "env-file" };

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
 * Apply a resolved credential so that SopsClient can use it.
 *
 * For keychain credentials, sets SOPS_AGE_KEY in the process environment — the key lives
 * only in process memory and is passed to the sops subprocess via its environment.
 *
 * Returns the ageKeyFile path to pass to the SopsClient constructor, or undefined when
 * the credential is already in the environment (env-key / env-file / keychain).
 */
export function prepareSopsEnv(credential: AgeCredential | null): string | undefined {
  if (!credential) return undefined;
  switch (credential.source) {
    case "keychain":
      process.env.SOPS_AGE_KEY = credential.privateKey;
      return undefined;
    case "config-file":
      return credential.path;
    case "env-key":
    case "env-file":
      return undefined; // SopsClient reads directly from process.env
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
