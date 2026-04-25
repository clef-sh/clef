import {
  AddTagsToResourceCommand,
  DeleteParameterCommand,
  GetParametersByPathCommand,
  ParameterTier,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import {
  MatrixManager,
  resolveIdentitySecrets,
  type BackendPackResult,
  type PackBackend,
  type PackRequest,
} from "@clef-sh/core";

/**
 * Options accepted via `--backend-opt key=value`. All values arrive as strings
 * from the CLI; {@link AwsParameterStoreBackend.validateOptions} narrows them.
 */
export interface AwsParameterStoreOptions {
  /** SSM hierarchy root, e.g. `/myapp/prod`. Required, must start with `/`. */
  prefix?: string;
  /** AWS region. Defaults to the SDK's resolution chain (env, profile, IMDS). */
  region?: string;
  /** KMS key id/alias/ARN for SecureString encryption. Defaults to `alias/aws/ssm`. */
  "kms-key-id"?: string;
  /** When `"true"`, delete parameters under the prefix that aren't in the current set. */
  prune?: string;
  /** SSM parameter tier. `Standard` (default) or `Advanced`. */
  tier?: string;
  /** Tag key prefix. Defaults to `clef:`. */
  "tag-prefix"?: string;
}

interface ResolvedOptions {
  prefix: string;
  region?: string;
  kmsKeyId?: string;
  prune: boolean;
  tier: ParameterTier;
  tagPrefix: string;
}

const STANDARD_TIER_VALUE_LIMIT_BYTES = 4096;

function resolveOptions(raw: Record<string, unknown>): ResolvedOptions {
  const opts = raw as AwsParameterStoreOptions;

  if (!opts.prefix) {
    throw new Error(
      "aws-parameter-store backend requires 'prefix' (pass via --backend-opt prefix=/your/path)",
    );
  }
  if (!opts.prefix.startsWith("/")) {
    throw new Error(`aws-parameter-store 'prefix' must begin with '/'; got '${opts.prefix}'.`);
  }

  const tierRaw = opts.tier ?? "Standard";
  if (tierRaw !== "Standard" && tierRaw !== "Advanced") {
    throw new Error(
      `aws-parameter-store 'tier' must be 'Standard' or 'Advanced'; got '${tierRaw}'.`,
    );
  }

  return {
    prefix: opts.prefix.replace(/\/+$/, ""),
    region: opts.region,
    kmsKeyId: opts["kms-key-id"],
    prune: opts.prune === "true",
    tier: tierRaw === "Advanced" ? ParameterTier.ADVANCED : ParameterTier.STANDARD,
    tagPrefix: opts["tag-prefix"] ?? "clef:",
  };
}

function paramName(prefix: string, key: string): string {
  return `${prefix}/${key}`;
}

async function listExistingParamNames(client: SSMClient, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await client.send(
      new GetParametersByPathCommand({
        Path: prefix,
        Recursive: false,
        WithDecryption: false,
        NextToken: nextToken,
      }),
    );
    for (const p of res.Parameters ?? []) {
      if (p.Name) names.push(p.Name);
    }
    nextToken = res.NextToken;
  } while (nextToken);
  return names;
}

/**
 * Pack backend that writes secrets to AWS SSM Parameter Store as
 * `SecureString` parameters under a user-supplied prefix.
 *
 * One parameter per Clef key. Auth uses the AWS SDK default credential chain.
 */
export class AwsParameterStoreBackend implements PackBackend {
  readonly id = "aws-parameter-store";
  readonly description = "Write secrets to AWS SSM Parameter Store as SecureString parameters.";

  private readonly clientFactory: (region?: string) => SSMClient;

  constructor(clientFactory?: (region?: string) => SSMClient) {
    this.clientFactory = clientFactory ?? ((region) => new SSMClient(region ? { region } : {}));
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
      req.services.encryption,
      matrixManager,
    );

    const revision = Date.now().toString();
    const tags = [
      { Key: `${opts.tagPrefix}identity`, Value: req.identity },
      { Key: `${opts.tagPrefix}environment`, Value: req.environment },
      { Key: `${opts.tagPrefix}revision`, Value: revision },
    ];

    const desiredKeys = Object.keys(resolved.values);

    if (opts.tier === ParameterTier.STANDARD) {
      for (const [key, value] of Object.entries(resolved.values)) {
        const byteLength = Buffer.byteLength(value, "utf8");
        if (byteLength > STANDARD_TIER_VALUE_LIMIT_BYTES) {
          throw new Error(
            `aws-parameter-store: value for '${key}' is ${byteLength} bytes, exceeding the ` +
              `Standard tier limit of ${STANDARD_TIER_VALUE_LIMIT_BYTES}. ` +
              "Pass --backend-opt tier=Advanced to enable larger values.",
          );
        }
      }
    }

    for (const [key, value] of Object.entries(resolved.values)) {
      const Name = paramName(opts.prefix, key);
      await client.send(
        new PutParameterCommand({
          Name,
          Value: value,
          Type: "SecureString",
          Overwrite: true,
          Tier: opts.tier,
          ...(opts.kmsKeyId ? { KeyId: opts.kmsKeyId } : {}),
        }),
      );
      await client.send(
        new AddTagsToResourceCommand({
          ResourceType: "Parameter",
          ResourceId: Name,
          Tags: tags,
        }),
      );
    }

    let prunedCount = 0;
    if (opts.prune) {
      const existing = await listExistingParamNames(client, opts.prefix);
      const desiredFullNames = new Set(desiredKeys.map((k) => paramName(opts.prefix, k)));
      const toDelete = existing.filter((n) => !desiredFullNames.has(n));
      for (const name of toDelete) {
        await client.send(new DeleteParameterCommand({ Name: name }));
        prunedCount += 1;
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
        prefix: opts.prefix,
        region: opts.region ?? null,
        tier: opts.tier,
        prunedCount,
      },
    };
  }
}

const backend: PackBackend = new AwsParameterStoreBackend();
export default backend;
