import {
  CreateSecretCommand,
  DeleteSecretCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
  TagResourceCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  MatrixManager,
  resolveIdentitySecrets,
  type BackendPackResult,
  type PackBackend,
  type PackRequest,
} from "@clef-sh/core";

/**
 * Options accepted via `--backend-opt key=value`. All values arrive as
 * strings from the CLI; {@link AwsSecretsManagerBackend.validateOptions}
 * narrows them.
 */
export interface AwsSecretsManagerOptions {
  /**
   * In `mode=json`: the full ASM secret name. In `mode=single`: the name
   * root, suffixed with `/<key>` per secret. Required.
   */
  prefix?: string;
  /** `json` (default) or `single`. */
  mode?: string;
  /** AWS region. Defaults to the SDK's resolution chain. */
  region?: string;
  /** KMS key id/alias/ARN. Applied on CreateSecret only. */
  "kms-key-id"?: string;
  /** When `"true"` and `mode=single`, soft-delete orphaned secrets. */
  prune?: string;
  /** Recovery window for soft delete, 7-30. Default 30. */
  "recovery-days"?: string;
  /** Tag key prefix. Defaults to `clef:`. */
  "tag-prefix"?: string;
}

type Mode = "json" | "single";

interface ResolvedOptions {
  prefix: string;
  mode: Mode;
  region?: string;
  kmsKeyId?: string;
  prune: boolean;
  recoveryDays: number;
  tagPrefix: string;
}

const ASM_VALUE_LIMIT_BYTES = 65536;
// AWS Secrets Manager allows: alphanumerics and these symbols: /_+=.@!-
const ASM_NAME_PATTERN = /^[A-Za-z0-9/_+=.@!-]+$/;

function resolveOptions(raw: Record<string, unknown>): ResolvedOptions {
  const opts = raw as AwsSecretsManagerOptions;

  if (!opts.prefix) {
    throw new Error(
      "aws-secrets-manager backend requires 'prefix' (pass via --backend-opt prefix=myapp/production)",
    );
  }
  if (!ASM_NAME_PATTERN.test(opts.prefix)) {
    throw new Error(
      `aws-secrets-manager 'prefix' must match ${ASM_NAME_PATTERN}; got '${opts.prefix}'.`,
    );
  }

  const modeRaw = opts.mode ?? "json";
  if (modeRaw !== "json" && modeRaw !== "single") {
    throw new Error(`aws-secrets-manager 'mode' must be 'json' or 'single'; got '${modeRaw}'.`);
  }

  const prune = opts.prune === "true";
  if (prune && modeRaw === "json") {
    throw new Error(
      "aws-secrets-manager 'prune=true' only applies to 'mode=single'; in JSON mode the cell is a single secret with no orphans to prune.",
    );
  }

  const recoveryDaysRaw = opts["recovery-days"] ?? "30";
  const recoveryDays = Number.parseInt(recoveryDaysRaw, 10);
  if (
    !Number.isInteger(recoveryDays) ||
    recoveryDays < 7 ||
    recoveryDays > 30 ||
    String(recoveryDays) !== recoveryDaysRaw
  ) {
    throw new Error(
      `aws-secrets-manager 'recovery-days' must be an integer between 7 and 30; got '${recoveryDaysRaw}'.`,
    );
  }

  return {
    prefix: opts.prefix,
    mode: modeRaw,
    region: opts.region,
    kmsKeyId: opts["kms-key-id"],
    prune,
    recoveryDays,
    tagPrefix: opts["tag-prefix"] ?? "clef:",
  };
}

interface Tag {
  Key: string;
  Value: string;
}

function buildTags(
  tagPrefix: string,
  identity: string,
  environment: string,
  revision: string,
): Tag[] {
  return [
    { Key: `${tagPrefix}identity`, Value: identity },
    { Key: `${tagPrefix}environment`, Value: environment },
    { Key: `${tagPrefix}revision`, Value: revision },
  ];
}

function isResourceNotFound(err: unknown): boolean {
  return (
    err instanceof ResourceNotFoundException ||
    (err instanceof Error && err.name === "ResourceNotFoundException")
  );
}

/**
 * Idempotent upsert: try `PutSecretValue` first (steady-state hot path),
 * fall back to `CreateSecret` with inline tags + KMS key if the secret
 * doesn't yet exist. Returns `true` when the secret was just created
 * (callers can skip the redundant TagResource call).
 */
async function upsertSecret(
  client: SecretsManagerClient,
  name: string,
  secretString: string,
  tags: Tag[],
  kmsKeyId: string | undefined,
): Promise<{ created: boolean }> {
  try {
    await client.send(
      new PutSecretValueCommand({
        SecretId: name,
        SecretString: secretString,
      }),
    );
    return { created: false };
  } catch (err) {
    if (!isResourceNotFound(err)) throw err;
  }

  await client.send(
    new CreateSecretCommand({
      Name: name,
      SecretString: secretString,
      Tags: tags,
      ...(kmsKeyId ? { KmsKeyId: kmsKeyId } : {}),
    }),
  );
  return { created: true };
}

async function refreshTags(client: SecretsManagerClient, name: string, tags: Tag[]): Promise<void> {
  await client.send(
    new TagResourceCommand({
      SecretId: name,
      Tags: tags,
    }),
  );
}

async function listExistingSecretNames(
  client: SecretsManagerClient,
  prefix: string,
): Promise<string[]> {
  const filterValue = `${prefix}/`;
  const names: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await client.send(
      new ListSecretsCommand({
        Filters: [{ Key: "name", Values: [filterValue] }],
        NextToken: nextToken,
      }),
    );
    for (const s of res.SecretList ?? []) {
      if (s.Name) names.push(s.Name);
    }
    nextToken = res.NextToken;
  } while (nextToken);
  return names;
}

function sortedJsonPayload(values: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(values).sort()) sorted[k] = values[k];
  return JSON.stringify(sorted);
}

/**
 * Pack backend that writes secrets to AWS Secrets Manager. Supports two
 * emission modes:
 *
 *  - `json` (default): one secret per `(identity, environment)` cell with
 *    all keys serialized as a JSON object. Canonical ASM idiom.
 *  - `single`: one secret per Clef key, named `<prefix>/<key>`.
 *
 * Auth uses the AWS SDK default credential chain.
 */
export class AwsSecretsManagerBackend implements PackBackend {
  readonly id = "aws-secrets-manager";
  readonly description =
    "Write secrets to AWS Secrets Manager (JSON-bundle by default, or one secret per key).";

  private readonly clientFactory: (region?: string) => SecretsManagerClient;

  constructor(clientFactory?: (region?: string) => SecretsManagerClient) {
    this.clientFactory =
      clientFactory ?? ((region) => new SecretsManagerClient(region ? { region } : {}));
  }

  validateOptions(raw: Record<string, unknown>): void {
    resolveOptions(raw);
  }

  async pack(req: PackRequest): Promise<BackendPackResult> {
    const opts = resolveOptions(req.backendOptions);
    const client = this.clientFactory(opts.region);

    const matrixManager = new MatrixManager();
    const resolved = await resolveIdentitySecrets(
      req.identity,
      req.environment,
      req.manifest,
      req.repoRoot,
      req.services.source,
      matrixManager,
    );

    const revision = Date.now().toString();
    const tags = buildTags(opts.tagPrefix, req.identity, req.environment, revision);

    // Flatten nested namespace → key → value into env-var-shaped names.
    // Both emission modes (json bundle, one secret per key) operate on this
    // qualified-form view; the namespace structure stays invisible from the
    // Secrets Manager side.
    const flatValues: Record<string, string> = {};
    for (const [ns, bucket] of Object.entries(resolved.values)) {
      for (const [k, v] of Object.entries(bucket)) {
        flatValues[`${ns}__${k}`] = v;
      }
    }
    const desiredKeys = Object.keys(flatValues);

    let secretCount: number;
    let prunedCount = 0;

    if (opts.mode === "json") {
      const payload = sortedJsonPayload(flatValues);
      const byteLength = Buffer.byteLength(payload, "utf8");
      if (byteLength > ASM_VALUE_LIMIT_BYTES) {
        throw new Error(
          `aws-secrets-manager: JSON payload for cell '${req.identity}/${req.environment}' is ` +
            `${byteLength} bytes, exceeding the ASM 64 KiB per-secret limit. ` +
            "Split the cell across namespaces or switch to --backend-opt mode=single.",
        );
      }

      const { created } = await upsertSecret(client, opts.prefix, payload, tags, opts.kmsKeyId);
      if (!created) {
        // Tags already applied inline on CreateSecret; only refresh on the
        // update branch so the revision tag tracks every pack.
        await refreshTags(client, opts.prefix, tags);
      }
      secretCount = 1;
    } else {
      for (const [key, value] of Object.entries(flatValues)) {
        const byteLength = Buffer.byteLength(value, "utf8");
        if (byteLength > ASM_VALUE_LIMIT_BYTES) {
          throw new Error(
            `aws-secrets-manager: value for '${key}' is ${byteLength} bytes, ` +
              `exceeding the ASM 64 KiB per-secret limit.`,
          );
        }
      }

      for (const [key, value] of Object.entries(flatValues)) {
        const name = `${opts.prefix}/${key}`;
        const { created } = await upsertSecret(client, name, value, tags, opts.kmsKeyId);
        if (!created) {
          await refreshTags(client, name, tags);
        }
      }
      secretCount = desiredKeys.length;

      if (opts.prune) {
        const existing = await listExistingSecretNames(client, opts.prefix);
        const desiredFullNames = new Set(desiredKeys.map((k) => `${opts.prefix}/${k}`));
        const orphans = existing.filter((n) => !desiredFullNames.has(n));
        for (const name of orphans) {
          await client.send(
            new DeleteSecretCommand({
              SecretId: name,
              RecoveryWindowInDays: opts.recoveryDays,
            }),
          );
          prunedCount += 1;
        }
      }
    }

    return {
      outputPath: "",
      namespaceCount: resolved.identity.namespaces.length,
      keyCount: desiredKeys.length,
      keys: desiredKeys,
      artifactSize: 0,
      revision,
      backend: this.id,
      details: {
        mode: opts.mode,
        secretCount,
        region: opts.region ?? null,
        prunedCount,
      },
    };
  }
}

const backend: PackBackend = new AwsSecretsManagerBackend();
export default backend;
