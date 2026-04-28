#!/usr/bin/env node
/**
 * Synth-time pack helper. Spawned as a subprocess by {@link ClefArtifactBucket}
 * (and future Clef CDK constructs) during CDK `synth`.
 *
 * Why a subprocess instead of calling {@link JsonEnvelopeBackend} in-process:
 * CDK construct constructors are synchronous, but the pack pipeline is async
 * (sops subprocess decrypt + dynamic ESM import of `age-encryption`). `execSync`
 * from the sync constructor blocks on this helper, which then uses the normal
 * async pipeline internally. This matches the idiom used by `NodejsFunction`
 * (shells out to esbuild), `PythonFunction` (shells out to pip), and
 * `DockerImageAsset` (shells out to docker build).
 *
 * Output contract: JSON envelope (from {@link JsonEnvelopeBackend}) written
 * verbatim to stdout. Errors written to stderr; non-zero exit on failure.
 *
 * Age credential sources (first non-empty wins): `CLEF_AGE_KEY` env, then
 * `CLEF_AGE_KEY_FILE`. Keychain lookup is intentionally not supported here —
 * CDK synth typically runs in CI where env vars are the contract.
 */
import { execFile } from "child_process";
import {
  JsonEnvelopeBackend,
  ManifestParser,
  MemoryPackOutput,
  SopsClient,
  isKmsEnvelope,
  resolveSopsPath,
} from "@clef-sh/core";
import type {
  ClefManifest,
  PackRequest,
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "@clef-sh/core";
import type { KmsProvider } from "@clef-sh/core";
import { regionFromAwsKmsArn } from "./kms-region";

class ExecFileRunner implements SubprocessRunner {
  async run(
    command: string,
    args: string[],
    options?: SubprocessOptions,
  ): Promise<SubprocessResult> {
    return new Promise((resolve) => {
      const child = execFile(
        command,
        args,
        {
          cwd: options?.cwd,
          env: options?.env ? { ...process.env, ...options.env } : undefined,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: error ? (error.code ? Number(error.code) : 1) : 0,
          });
        },
      );
      if (options?.stdin && child.stdin) {
        child.stdin.write(options.stdin);
        child.stdin.end();
      }
    });
  }
}

interface HelperArgs {
  manifest: string;
  identity: string;
  environment: string;
  /** Optional path to write the list of key names to. Omitted by callers that
   *  don't need the sidecar (e.g. ClefArtifactBucket). */
  keysOut?: string;
}

function parseArgs(argv: string[]): HelperArgs {
  const out: Partial<HelperArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === "--manifest") out.manifest = next();
    else if (a === "--identity") out.identity = next();
    else if (a === "--environment") out.environment = next();
    else if (a === "--keys-out") out.keysOut = next();
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.manifest || !out.identity || !out.environment) {
    throw new Error(
      "Usage: clef-cdk-pack-helper --manifest <path> --identity <name> --environment <name> [--keys-out <path>]",
    );
  }
  return out as HelperArgs;
}

async function resolveKmsProviderIfNeeded(
  manifest: ClefManifest,
  identity: string,
  environment: string,
): Promise<KmsProvider | undefined> {
  const si = manifest.service_identities?.find((s) => s.name === identity);
  const envConfig = si?.environments[environment];
  if (!envConfig || !isKmsEnvelope(envConfig)) return undefined;
  // Dynamic import — @clef-sh/runtime is a dependency, but keeping this lazy
  // lets age-only synth runs skip loading the AWS SDK.
  const runtime = await import("@clef-sh/runtime");
  // Translate manifest semantics into a runtime KMS provider. The manifest
  // parser guarantees AWS keyIds are full ARNs, so the region is always
  // recoverable from the ARN; the runtime provider stays a dumb primitive.
  const region =
    envConfig.kms.provider === "aws" ? regionFromAwsKmsArn(envConfig.kms.keyId) : undefined;
  return runtime.createKmsProvider(envConfig.kms.provider, { region });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const parser = new ManifestParser();
  const manifest = parser.parse(args.manifest);

  // repoRoot is the manifest's directory — every ArtifactPacker path is
  // resolved relative to it (file_pattern, SOPS source files).
  const path = await import("path");
  const repoRoot = path.dirname(path.resolve(args.manifest));

  const runner = new ExecFileRunner();
  // resolveSopsPath throws if no sops binary is available; let it propagate
  // so users see the install hint from @clef-sh/core.
  resolveSopsPath();

  const sopsClient = new SopsClient(
    runner,
    process.env.CLEF_AGE_KEY_FILE,
    process.env.CLEF_AGE_KEY,
  );

  const kms = await resolveKmsProviderIfNeeded(manifest, args.identity, args.environment);

  const output = new MemoryPackOutput();
  const backend = new JsonEnvelopeBackend();
  const request: PackRequest = {
    identity: args.identity,
    environment: args.environment,
    manifest,
    repoRoot,
    services: { encryption: sopsClient, kms, runner },
    backendOptions: { output },
  };
  backend.validateOptions?.(request.backendOptions);
  const result = await backend.pack(request);

  if (!output.json) {
    throw new Error("Pack completed but produced no JSON envelope (internal error).");
  }

  // Write the plaintext key names sidecar when requested. Names only — values
  // stay encrypted in the envelope. The shape-template validator queries by
  // (namespace, key), so the sidecar groups names by namespace.
  if (args.keysOut) {
    const fs = await import("fs");
    const keysByNamespace: Record<string, string[]> = {};
    for (const flat of result.keys) {
      const idx = flat.indexOf("__");
      if (idx === -1) continue; // packer always qualifies; defensive skip
      const ns = flat.slice(0, idx);
      const k = flat.slice(idx + 2);
      (keysByNamespace[ns] ??= []).push(k);
    }
    fs.writeFileSync(args.keysOut, JSON.stringify(keysByNamespace), "utf-8");
  }

  process.stdout.write(output.json);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`clef-cdk pack-helper failed: ${msg}\n`);
  process.exit(1);
});
