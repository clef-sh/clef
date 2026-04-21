import { execFileSync } from "child_process";
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

/**
 * Run the pack-helper as a child Node process and return the envelope JSON.
 *
 * Blocking by design — CDK construct constructors are synchronous, and this
 * is how `NodejsFunction` / `PythonFunction` / `DockerImageAsset` produce
 * synth-time content. Subprocess inherits the parent's env (age key vars,
 * AWS credentials for KMS envelope identities).
 */
export function invokePackHelper(args: InvokePackHelperArgs): string {
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
      ],
      {
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return buf.toString("utf-8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const stderr =
      typeof e.stderr === "string" ? e.stderr : e.stderr ? e.stderr.toString("utf-8") : e.message;
    throw new Error(
      `Clef pack-helper failed for '${args.identity}/${args.environment}':\n${stderr.trim()}`,
    );
  }
}
