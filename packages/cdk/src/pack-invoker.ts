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
 * Run the pack-helper as a child Node process and return the envelope JSON
 * plus the plaintext list of key names.
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
