import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Path to the bundled pack-helper Node entry. Resolved relative to this
 * compiled module — after `tsc`, both files sit side-by-side in `dist/`.
 */
const HELPER_PATH = path.resolve(__dirname, "pack-helper.js");

export interface InvokePackHelperArgs {
  manifest: string;
  identity: string;
  environment: string;
}

export interface PackHelperResult {
  /** The envelope JSON on stdout — still the canonical PackedArtifact string. */
  envelopeJson: string;
  /**
   * Plaintext list of key names present in the envelope. Written to a temp
   * sidecar by the helper and read back here. Names only; values stay
   * encrypted in the envelope ciphertext.
   */
  keys: string[];
}

/**
 * Memoization cache — synth-scoped. Multiple constructs (e.g. several
 * `ClefSecret` instances for the same identity/environment) share a
 * single pack-helper invocation. Keyed on the input tuple because the
 * envelope revision changes every run: without memoization, each
 * construct would get a different envelope, confusing CFN's resource
 * dedup.
 */
const packCache = new Map<string, PackHelperResult>();

/**
 * Test-only hook. Clears the pack-helper memoization so each test starts
 * fresh. Production synth runs in a short-lived process and doesn't need
 * this.
 */
export function resetPackHelperCache(): void {
  packCache.clear();
}

/**
 * Run the pack-helper as a child Node process and return the envelope JSON
 * plus the plaintext list of key names. Memoized per (manifest, identity,
 * environment) within a single process lifetime.
 *
 * Blocking by design — CDK construct constructors are synchronous, and this
 * is how `NodejsFunction` / `PythonFunction` / `DockerImageAsset` produce
 * synth-time content. Subprocess inherits the parent's env (age key vars,
 * AWS credentials for KMS envelope identities).
 *
 * The keys sidecar is written to a temp path and unlinked after read.
 * Consumers that don't need keys (e.g. ClefArtifactBucket) just ignore the
 * field.
 */
export function invokePackHelper(args: InvokePackHelperArgs): PackHelperResult {
  const cacheKey = `${args.manifest}|${args.identity}|${args.environment}`;
  const cached = packCache.get(cacheKey);
  if (cached) return cached;
  const result = runPackHelper(args);
  packCache.set(cacheKey, result);
  return result;
}

function runPackHelper(args: InvokePackHelperArgs): PackHelperResult {
  const keysOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clef-cdk-keys-")), "keys.json");
  try {
    const buf = execFileSync(
      process.execPath,
      [
        HELPER_PATH,
        "--manifest",
        args.manifest,
        "--identity",
        args.identity,
        "--environment",
        args.environment,
        "--keys-out",
        keysOut,
      ],
      {
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        // Explicitly pass the parent's env so Clef credential vars
        // (CLEF_AGE_KEY / CLEF_AGE_KEY_FILE) and AWS SDK config reach the
        // helper. Some test harnesses (notably Jest with ts-jest) wrap the
        // worker in a way that drops the default inheritance.
        env: process.env,
      },
    );
    const envelopeJson = buf.toString("utf-8");
    const rawKeys = fs.readFileSync(keysOut, "utf-8");
    const keys = JSON.parse(rawKeys) as string[];
    return { envelopeJson, keys };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const stderr =
      typeof e.stderr === "string" ? e.stderr : e.stderr ? e.stderr.toString("utf-8") : e.message;
    throw new Error(
      `Clef pack-helper failed for '${args.identity}/${args.environment}':\n${stderr.trim()}`,
    );
  } finally {
    try {
      fs.rmSync(path.dirname(keysOut), { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; tmpdir sweepers handle stragglers.
    }
  }
}
