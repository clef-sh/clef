# ADR: Cloud Backend CLI Changes

Architecture Decision Record

Version 0.1 | April 2026

Classification: Internal — Engineering

**DRAFT**

*This ADR specifies the exact code changes required to add the `cloud` backend to the Clef CLI and core library. Each decision references specific files, line numbers, and before/after code. This is the implementation blueprint — the PRDs define what and why; this defines how.*

---

# ADR-001: Add `"cloud"` to `BackendType`

## Context

The `BackendType` union at `packages/core/src/types/index.ts:51` controls which encryption backends the system recognizes. The `cloud` backend represents Clef Cloud's managed KMS, accessed via the keyservice sidecar.

## Decision

Add `"cloud"` to the union. Do not add new fields to `EnvironmentSopsOverride` — the `cloud` backend reads its key ID from `manifest.cloud.keyId`, not from per-environment SOPS override fields.

## Changes

### `packages/core/src/types/index.ts`

**Line 35-37 — Extend `ClefCloudConfig`:**
```typescript
// Before
export interface ClefCloudConfig {
  integrationId: string;
}

// After
export interface ClefCloudConfig {
  integrationId: string;
  keyId: string;
}
```

**Line 51 — Extend `BackendType`:**
```typescript
// Before
export type BackendType = "age" | "awskms" | "gcpkms" | "azurekv" | "pgp";

// After
export type BackendType = "age" | "awskms" | "gcpkms" | "azurekv" | "pgp" | "cloud";
```

**Line 118-125 — No change to `SopsConfig`.** The `cloud` backend does not add a global SOPS config field. The key ID comes from `manifest.cloud.keyId`.

**Line 131-144 — Extend `ClefLocalConfig`:** No change. Cloud credentials live in `~/.clef/credentials.yaml` (user-scoped), not in `.clef/config.yaml` (project-scoped).

### New file: `~/.clef/credentials.yaml` schema

```typescript
// In packages/core/src/types/index.ts, add after ClefLocalConfig:

/** User-scoped Cloud credentials stored in ~/.clef/credentials.yaml. */
export interface ClefCloudCredentials {
  /** Bearer token for Cloud API authentication. */
  token: string;
  /** Cloud API endpoint override. Defaults to https://api.clef.sh. */
  endpoint?: string;
}
```

## Rationale

- `cloud` is distinct from `awskms` because `awskms` means "user has local AWS credentials and SOPS calls KMS directly." `cloud` means "user has a Clef Cloud token and SOPS calls KMS through the keyservice sidecar."
- `keyId` is required on `ClefCloudConfig` (not optional) because any manifest that declares `cloud` as a backend must have a key ID. The `clef cloud init` command writes both fields atomically.
- No new fields on `EnvironmentSopsOverride` because the `cloud` backend doesn't have an environment-level key — it reads from `manifest.cloud.keyId`. (Multi-key support is a future enhancement per the PRD.)

---

# ADR-002: SopsClient — Keyservice Injection

## Context

The `SopsClient` class (`packages/core/src/sops/client.ts`) wraps all SOPS subprocess calls. When the `cloud` backend is active, every SOPS invocation must include:

```
--enable-local-keyservice=false --keyservice tcp://127.0.0.1:<port>
```

This applies to **both** encrypt and decrypt. The encrypt path uses `buildEncryptArgs()` (line 479) which has a switch on backend. The decrypt path (line 119) passes args directly with no backend-specific logic — SOPS reads the backend from the encrypted file's metadata.

The challenge: the keyservice args must be injected into both paths, but the decrypt path has no mechanism for it today.

## Decision

Add an optional `keyserviceAddr` parameter to the `SopsClient` constructor. When set, all SOPS invocations include the keyservice flags. This is constructor-level injection because the keyservice sidecar lives for the duration of the CLI command — every SOPS call within that command uses the same address.

## Changes

### `packages/core/src/sops/client.ts`

**Lines 79-98 — Constructor:**
```typescript
// Before
export class SopsClient implements EncryptionBackend {
  private readonly sopsCommand: string;

  constructor(
    private readonly runner: SubprocessRunner,
    private readonly ageKeyFile?: string,
    private readonly ageKey?: string,
    sopsPath?: string,
  ) {
    this.sopsCommand = sopsPath ?? resolveSopsPath().path;
  }

// After
export class SopsClient implements EncryptionBackend {
  private readonly sopsCommand: string;
  private readonly keyserviceArgs: string[];

  constructor(
    private readonly runner: SubprocessRunner,
    private readonly ageKeyFile?: string,
    private readonly ageKey?: string,
    sopsPath?: string,
    private readonly keyserviceAddr?: string,
  ) {
    this.sopsCommand = sopsPath ?? resolveSopsPath().path;
    this.keyserviceArgs = keyserviceAddr
      ? ["--enable-local-keyservice=false", "--keyservice", keyserviceAddr]
      : [];
  }
```

**Lines 119-129 — Decrypt args (inject keyservice):**
```typescript
// Before
    const result = await this.runner.run(
      this.sopsCommand,
      ["decrypt", "--output-type", fmt, filePath],
      {
        ...(env ? { env } : {}),
      },
    );

// After
    const result = await this.runner.run(
      this.sopsCommand,
      [...this.keyserviceArgs, "decrypt", "--output-type", fmt, filePath],
      {
        ...(env ? { env } : {}),
      },
    );
```

**Lines 205-219 — Encrypt args (inject keyservice):**
```typescript
// Before
      result = await this.runner.run(
        this.sopsCommand,
        [
          "--config",
          configPath,
          "encrypt",
          ...args,
          "--input-type",
          fmt,
          "--output-type",
          fmt,
          "--filename-override",
          filePath,
          inputArg,
        ],

// After
      result = await this.runner.run(
        this.sopsCommand,
        [
          "--config",
          configPath,
          ...this.keyserviceArgs,
          "encrypt",
          ...args,
          "--input-type",
          fmt,
          "--output-type",
          fmt,
          "--filename-override",
          filePath,
          inputArg,
        ],
```

**Lines 267-270 — Rotate/addRecipient args (inject keyservice):**
```typescript
// Before
    const result = await this.runner.run(
      this.sopsCommand,
      ["rotate", "-i", "--add-age", key, filePath],

// After
    const result = await this.runner.run(
      this.sopsCommand,
      [...this.keyserviceArgs, "rotate", "-i", "--add-age", key, filePath],
```

**Lines 431-442 — `detectBackend()` (add cloud detection):**
```typescript
// Before
  private detectBackend(
    sops: Record<string, unknown>,
  ): "age" | "awskms" | "gcpkms" | "azurekv" | "pgp" {
    if (sops.age && Array.isArray(sops.age) && (sops.age as unknown[]).length > 0) return "age";
    if (sops.kms && Array.isArray(sops.kms) && (sops.kms as unknown[]).length > 0) return "awskms";
    // ... other checks ...
    return "age";
  }

// After
  private detectBackend(
    sops: Record<string, unknown>,
  ): BackendType {
    if (sops.age && Array.isArray(sops.age) && (sops.age as unknown[]).length > 0) return "age";
    if (sops.kms && Array.isArray(sops.kms) && (sops.kms as unknown[]).length > 0) {
      const firstArn = (sops.kms as Array<Record<string, unknown>>)[0]?.arn;
      if (typeof firstArn === "string" && firstArn.startsWith("clef:")) {
        return "cloud";
      }
      return "awskms";
    }
    // ... other checks unchanged ...
    return "age";
  }
```

**Lines 444-477 — `extractRecipients()` (add cloud case):**
```typescript
// Before — signature
  private extractRecipients(
    sops: Record<string, unknown>,
    backend: "age" | "awskms" | "gcpkms" | "azurekv" | "pgp",
  ): string[] {

// After — signature
  private extractRecipients(
    sops: Record<string, unknown>,
    backend: BackendType,
  ): string[] {

// Add case inside switch, after "awskms":
      case "cloud": {
        const entries = sops.kms as Array<Record<string, unknown>> | undefined;
        return entries?.map((e) => String(e.arn ?? "")) ?? [];
      }
```

**Lines 479-531 — `buildEncryptArgs()` (add cloud case):**
```typescript
// Add case inside switch, after "pgp":
      case "cloud": {
        const cloudKeyId = manifest.cloud?.keyId;
        if (cloudKeyId) {
          args.push("--kms", cloudKeyId);
        }
        break;
      }
```

## Rationale

- Constructor injection ensures every SOPS call gets keyservice args. Per-method injection would require touching every method and risks missing one.
- `keyserviceArgs` is pre-computed as an array in the constructor. When empty (no keyservice), spreading `[]` is a no-op — zero overhead for non-cloud paths.
- The keyservice flags go before the subcommand (`encrypt`/`decrypt`). SOPS treats `--keyservice` and `--enable-local-keyservice` as global flags, not subcommand flags. Placing them after `--config` and before the subcommand matches SOPS's expected arg order.
- `detectBackend` distinguishes `cloud` from `awskms` by checking whether `sops.kms[0].arn` starts with `clef:`. Both backends use SOPS's `kms` metadata array — the key ID format is the discriminator.

---

# ADR-003: Manifest Parser — Cloud Validation

## Context

The manifest parser (`packages/core/src/manifest/parser.ts`) validates `clef.yaml`. The `cloud` backend needs:

1. `"cloud"` in `VALID_BACKENDS`
2. Cross-field validation: `cloud` backend requires `cloud.keyId` in the manifest
3. Format validation on `cloud.keyId`

## Decision

Add `"cloud"` to `VALID_BACKENDS`. Add cross-field validation after the cloud block is parsed. The `cloud` backend has no per-environment required field (unlike `awskms` which requires `aws_kms_arn`) because it reads from the top-level `cloud.keyId`.

## Changes

### `packages/core/src/manifest/parser.ts`

**Line 31 — VALID_BACKENDS:**
```typescript
// Before
const VALID_BACKENDS = ["age", "awskms", "gcpkms", "azurekv", "pgp"] as const;

// After
const VALID_BACKENDS = ["age", "awskms", "gcpkms", "azurekv", "pgp", "cloud"] as const;
```

**Lines 628-642 — Cloud parsing (extend):**
```typescript
// Before
    // cloud (optional)
    let cloud: ClefCloudConfig | undefined;
    if (obj.cloud !== undefined) {
      // ... existing validation ...
      cloud = { integrationId: cloudObj.integrationId };
    }

// After
    // cloud (optional)
    let cloud: ClefCloudConfig | undefined;
    if (obj.cloud !== undefined) {
      if (typeof obj.cloud !== "object" || obj.cloud === null || Array.isArray(obj.cloud)) {
        throw new ManifestValidationError("Field 'cloud' must be an object.", "cloud");
      }
      const cloudObj = obj.cloud as Record<string, unknown>;
      if (typeof cloudObj.integrationId !== "string" || cloudObj.integrationId.length === 0) {
        throw new ManifestValidationError(
          "Field 'cloud.integrationId' is required and must be a non-empty string.",
          "cloud",
        );
      }
      if (typeof cloudObj.keyId !== "string" || cloudObj.keyId.length === 0) {
        throw new ManifestValidationError(
          "Field 'cloud.keyId' is required and must be a non-empty string.",
          "cloud",
        );
      }
      if (!/^clef:[a-z0-9_]+\/[a-z0-9_-]+$/.test(cloudObj.keyId)) {
        throw new ManifestValidationError(
          `Field 'cloud.keyId' has invalid format '${cloudObj.keyId}'. ` +
            "Must match: clef:<integrationId>/<keyAlias>",
          "cloud",
        );
      }
      cloud = { integrationId: cloudObj.integrationId, keyId: cloudObj.keyId };
    }
```

**After line 642 — Cross-field validation (new):**
```typescript
    // Validate: cloud backend requires cloud config
    const usesCloudBackend =
      sopsConfig.default_backend === "cloud" ||
      environments.some((e) => e.sops?.backend === "cloud");
    if (usesCloudBackend && !cloud) {
      throw new ManifestValidationError(
        "One or more environments use the 'cloud' backend but the manifest is missing " +
          "the top-level 'cloud' block with 'integrationId' and 'keyId'.",
        "cloud",
      );
    }
```

## Rationale

- The `cloud` backend doesn't need a per-environment required field check at line 193-216 (where `awskms` checks for `aws_kms_arn`) because the key ID is at the manifest level, not the environment level.
- The `keyId` regex is strict: `^clef:[a-z0-9_]+\/[a-z0-9_-]+$`. This prevents typos and enforces the Clef key ID format at parse time. A bad key ID caught at validation is much better than a 403 from the Cloud API at encrypt time.
- Cross-field validation (cloud backend declared but no cloud block) catches partial setup — e.g., someone manually edits `clef.yaml` to set `backend: cloud` without running `clef cloud init`.

---

# ADR-004: `resolveBackendConfig` — Cloud Fallback

## Context

`resolveBackendConfig` at `packages/core/src/types/index.ts:78-91` resolves per-environment backend config. When an environment has no override, it falls back to global `sops` config. The fallback constructs an `EnvironmentSopsOverride` from global fields — but there's no global field for `cloud`.

## Decision

The function already works correctly for `cloud` without changes. When `env.sops` has `backend: "cloud"`, it returns that override directly (line 83). When the global `sops.default_backend` is `"cloud"`, the fallback at line 84-91 returns `{ backend: "cloud" }` with no provider-specific fields — which is correct, because `buildEncryptArgs` reads `manifest.cloud.keyId` directly.

## Changes

No changes to `resolveBackendConfig`. Document this as-is behavior.

---

# ADR-005: Backend Migration — Cloud Target

## Context

`BackendMigrator` in `packages/core/src/migration/backend.ts` uses `BACKEND_KEY_FIELDS` (line 49-55) to map backends to their key field in `EnvironmentSopsOverride`.

## Decision

Add `cloud: undefined` to the mapping. The `cloud` backend has no per-environment key field — the key ID comes from `manifest.cloud.keyId`.

## Changes

### `packages/core/src/migration/backend.ts`

**Lines 49-55:**
```typescript
// Before
const BACKEND_KEY_FIELDS: Record<BackendType, keyof EnvironmentSopsOverride | undefined> = {
  age: undefined,
  awskms: "aws_kms_arn",
  gcpkms: "gcp_kms_resource_id",
  azurekv: "azure_kv_url",
  pgp: "pgp_fingerprint",
};

// After
const BACKEND_KEY_FIELDS: Record<BackendType, keyof EnvironmentSopsOverride | undefined> = {
  age: undefined,
  awskms: "aws_kms_arn",
  gcpkms: "gcp_kms_resource_id",
  azurekv: "azure_kv_url",
  pgp: "pgp_fingerprint",
  cloud: undefined,
};
```

## Rationale

- `cloud: undefined` mirrors `age: undefined` — both backends have no per-environment key field in the SOPS override.
- The `ALL_KEY_FIELDS` filter at line 57-59 already handles `undefined` values correctly (filters them out).
- `metadataMatchesTarget` at line 61-65 compares `meta.recipients` against `target.key`. For cloud, the "recipient" is the Clef key ID (extracted by `extractRecipients`), which will match the `target.key` passed by the migration caller.

---

# ADR-006: Keyservice Sidecar Lifecycle

## Context

The `cloud` backend requires a `clef-keyservice` binary running as a localhost gRPC server. The CLI spawns it, reads the port, passes the address to SopsClient, and kills it when done.

## Decision

Create a new module at `packages/core/src/cloud/keyservice.ts` that manages the sidecar lifecycle. Model the binary resolution on `packages/core/src/sops/resolver.ts`.

## Changes

### New file: `packages/core/src/cloud/keyservice.ts`

```typescript
import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";

export interface KeyserviceHandle {
  /** Address for --keyservice flag, e.g., "tcp://127.0.0.1:12345" */
  addr: string;
  /** Gracefully stop the keyservice process. */
  kill(): Promise<void>;
}

const PORT_REGEX = /^PORT=(\d+)$/;
const STARTUP_TIMEOUT_MS = 5000;

export async function spawnKeyservice(options: {
  binaryPath: string;
  token: string;
  endpoint?: string;
}): Promise<KeyserviceHandle> {
  const args = [
    "--token", options.token,
    "--addr", "127.0.0.1:0",
  ];
  if (options.endpoint) {
    args.push("--endpoint", options.endpoint);
  }

  const child = spawn(options.binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const port = await readPort(child);
  const addr = `tcp://127.0.0.1:${port}`;

  return {
    addr,
    kill: () => killGracefully(child),
  };
}

function readPort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Keyservice did not start within 5 seconds."));
    }, STARTUP_TIMEOUT_MS);

    const rl = readline.createInterface({ input: child.stdout! });

    rl.on("line", (line) => {
      const match = PORT_REGEX.exec(line);
      if (match) {
        clearTimeout(timer);
        rl.close();
        resolve(parseInt(match[1], 10));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start keyservice: ${err.message}`));
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Keyservice exited unexpectedly with code ${code}.`));
    });
  });
}

function killGracefully(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
```

### New file: `packages/core/src/cloud/resolver.ts`

```typescript
import * as fs from "fs";
import * as path from "path";

export type KeyserviceSource = "env" | "bundled" | "system";

export interface KeyserviceResolution {
  path: string;
  source: KeyserviceSource;
}

let cached: KeyserviceResolution | undefined;

/**
 * Resolve the clef-keyservice binary path.
 *
 * Resolution order (mirrors resolveSopsPath):
 *   1. CLEF_KEYSERVICE_PATH env var
 *   2. Bundled @clef-sh/keyservice-{platform}-{arch} package
 *   3. System PATH fallback
 */
export function resolveKeyservicePath(): KeyserviceResolution {
  if (cached) return cached;

  const envPath = process.env.CLEF_KEYSERVICE_PATH?.trim();
  if (envPath) {
    if (!fs.existsSync(envPath)) {
      throw new Error(
        `CLEF_KEYSERVICE_PATH points to '${envPath}' but the file does not exist.`,
      );
    }
    cached = { path: envPath, source: "env" };
    return cached;
  }

  const bundledPath = tryBundledKeyservice();
  if (bundledPath) {
    cached = { path: bundledPath, source: "bundled" };
    return cached;
  }

  cached = { path: "clef-keyservice", source: "system" };
  return cached;
}

function tryBundledKeyservice(): string | null {
  const pkg = `@clef-sh/keyservice-${process.platform}-${process.arch}`;
  try {
    const binPath = require.resolve(`${pkg}/bin/clef-keyservice`);
    if (fs.existsSync(binPath)) return binPath;
  } catch {
    // Package not installed — expected when optionalDependency is skipped
  }
  return null;
}

export function resetKeyserviceResolution(): void {
  cached = undefined;
}
```

### New file: `packages/core/src/cloud/credentials.ts`

```typescript
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as YAML from "yaml";
import type { ClefCloudCredentials } from "../types";

const CREDENTIALS_FILENAME = "credentials.yaml";
const DEFAULT_ENDPOINT = "https://api.clef.sh";

/**
 * Read Cloud credentials from ~/.clef/credentials.yaml.
 * Returns null if the file does not exist.
 */
export function readCloudCredentials(): ClefCloudCredentials | null {
  const credPath = path.join(os.homedir(), ".clef", CREDENTIALS_FILENAME);
  if (!fs.existsSync(credPath)) return null;
  const raw = YAML.parse(fs.readFileSync(credPath, "utf-8"));
  if (!raw?.token || typeof raw.token !== "string") return null;
  return {
    token: raw.token,
    endpoint: typeof raw.endpoint === "string" ? raw.endpoint : DEFAULT_ENDPOINT,
  };
}

/**
 * Write Cloud credentials to ~/.clef/credentials.yaml.
 * Creates ~/.clef/ if it doesn't exist.
 */
export function writeCloudCredentials(credentials: ClefCloudCredentials): void {
  const clefDir = path.join(os.homedir(), ".clef");
  if (!fs.existsSync(clefDir)) {
    fs.mkdirSync(clefDir, { mode: 0o700 });
  }
  const credPath = path.join(clefDir, CREDENTIALS_FILENAME);
  fs.writeFileSync(credPath, YAML.stringify(credentials), { mode: 0o600 });
}
```

## Rationale

- The keyservice binary is bundled via npm `optionalDependencies` (`@clef-sh/keyservice-{platform}-{arch}`), exactly like the SOPS binary. Resolution follows the same three-tier pattern: env var → bundled package → system PATH. No lazy download needed — `npm install` handles it.
- The sidecar reads `PORT=<port>` from stdout — this matches the keyservice binary's documented output format.
- Credentials are stored at `~/.clef/credentials.yaml` (user-scoped, file mode 0600) rather than in `.clef/config.yaml` (project-scoped) because the token is tied to the user's Clef account, not the repository.
- `killGracefully` sends SIGTERM with a 3-second timeout before SIGKILL. This matches the keyservice binary's graceful shutdown handler (SIGINT/SIGTERM → `srv.GracefulStop()`).

---

# ADR-007: Pack Command — `--remote` and `--push` Flags

## Context

`packages/cli/src/commands/pack.ts` currently packs locally and writes to `--output`. Cloud integration adds two new modes.

## Decision

Add `--remote` and `--push` as mutually exclusive options. `--remote` sends the bundle to Cloud for pack + store. `--push` packs locally and uploads the artifact. Both require `CLEF_CLOUD_TOKEN` or `~/.clef/credentials.yaml`.

## Changes

### `packages/cli/src/commands/pack.ts`

**Lines 28-37 — Add options:**
```typescript
    // After existing .option() calls, before .action():
    .option("--remote", "Send encrypted files to Cloud for packing and serving")
    .option("--push", "Pack locally and upload artifact to Cloud for serving")
```

**Lines 42-47 — Extend opts type:**
```typescript
        opts: {
          output?: string;  // Change from required to optional (not needed with --remote)
          ttl?: string;
          signingKey?: string;
          signingKmsKey?: string;
          remote?: boolean;
          push?: boolean;
        },
```

**Line 28 — Change `--output` from required to optional:**
```typescript
    // Before
    .requiredOption("-o, --output <path>", "Output file path for the artifact JSON")

    // After
    .option("-o, --output <path>", "Output file path for the artifact JSON")
```

**Lines 49-53 — Add validation at start of action:**
```typescript
          // Mutual exclusivity
          if (opts.remote && opts.push) {
            formatter.error("Cannot specify both --remote and --push.");
            process.exit(1);
            return;
          }

          // --output required for local pack, not for --remote
          if (!opts.remote && !opts.output) {
            formatter.error("--output is required for local pack. Use --remote for Cloud packing.");
            process.exit(1);
            return;
          }
```

**After line 98 — Add Cloud upload logic:**
```typescript
          // Cloud modes
          if (opts.remote) {
            // Remote pack: send bundle to Cloud
            const { readCloudCredentials } = await import("@clef-sh/core");
            const creds = readCloudCredentials();
            const token = process.env.CLEF_CLOUD_TOKEN ?? creds?.token;
            if (!token) {
              formatter.error(
                "Cloud token required. Set CLEF_CLOUD_TOKEN or run 'clef cloud login'.",
              );
              process.exit(1);
              return;
            }

            formatter.print(
              `${sym("working")}  Sending to Cloud for packing...`,
            );

            const { CloudPackClient } = await import("@clef-sh/core");
            const packClient = new CloudPackClient(creds?.endpoint);
            const remoteResult = await packClient.pack(token, {
              identity,
              environment,
              manifest,
              repoRoot,
              ttl,
            });

            formatter.success(`Artifact packed by Cloud: revision ${remoteResult.revision}`);
            return;
          }

          if (opts.push) {
            // Local pack + push artifact to Cloud
            const { readCloudCredentials } = await import("@clef-sh/core");
            const creds = readCloudCredentials();
            const token = process.env.CLEF_CLOUD_TOKEN ?? creds?.token;
            if (!token) {
              formatter.error(
                "Cloud token required. Set CLEF_CLOUD_TOKEN or run 'clef cloud login'.",
              );
              process.exit(1);
              return;
            }

            // Pack locally first (result already computed above)
            formatter.print(`${sym("working")}  Uploading artifact to Cloud...`);

            const { CloudArtifactClient } = await import("@clef-sh/core");
            const artifactClient = new CloudArtifactClient(creds?.endpoint);
            await artifactClient.upload(token, {
              identity,
              environment,
              artifactPath: result.outputPath,
            });

            formatter.success("Artifact uploaded to Cloud.");
            return;
          }
```

## Rationale

- `--output` changes from required to optional because `--remote` doesn't produce a local file. Validation enforces that `--output` is present for local pack.
- `--remote` and `--push` are mutually exclusive — they represent fundamentally different flows (Cloud packs vs. user packs).
- Token resolution: `CLEF_CLOUD_TOKEN` env var takes precedence over `~/.clef/credentials.yaml`. This matches the CI pattern where the token is in CI secrets.
- Dynamic imports (`await import("@clef-sh/core")`) for Cloud-specific modules keep the non-Cloud code path free of Cloud dependencies.

---

# ADR-008: Cloud Command Registration

## Context

The `clef cloud` command group needs to be registered in `packages/cli/src/index.ts` and implemented in a new file.

## Decision

Create `packages/cli/src/commands/cloud.ts` with subcommands: `init`, `login`, `status`. Register in index.ts.

## Changes

### `packages/cli/src/index.ts`

**Add import (after line ~28):**
```typescript
import { registerCloudCommand } from "./commands/cloud";
```

**Add registration (before `program.parseAsync`):**
```typescript
registerCloudCommand(program, deps);
```

### New file: `packages/cli/src/commands/cloud.ts`

The `cloud` command is a Commander subcommand group:

```typescript
export function registerCloudCommand(
  program: Command,
  deps: { runner: SubprocessRunner },
): void {
  const cloud = program
    .command("cloud")
    .description("Manage Clef Cloud integration.");

  // clef cloud init --env <environment>
  cloud
    .command("init")
    .description("Set up Clef Cloud for an environment.")
    .requiredOption("--env <environment>", "Target environment (e.g., production)")
    .action(async (opts: { env: string }) => {
      // Device flow: see PRD Section 6.3
      // 1. POST /api/v1/device/init
      // 2. Open browser to loginUrl
      // 3. Poll /api/v1/device/poll/:sessionId
      // 4. On complete: store token, download keyservice, update manifest, re-encrypt
    });

  // clef cloud login
  cloud
    .command("login")
    .description("Authenticate with Clef Cloud.")
    .action(async () => {
      // Device flow: auth only, no payment/provisioning
    });

  // clef cloud status
  cloud
    .command("status")
    .description("Show Clef Cloud integration status.")
    .action(async () => {
      // Read manifest, check cloud config, verify credentials, show status
    });
}
```

The full implementation of `cloud init` (device flow, browser open, polling, keyservice download, manifest update, re-encryption) is the most complex piece and will be detailed in the implementation plan.

---

# Summary: Change Impact

| File | Type | Lines touched | Risk |
|------|------|--------------|------|
| `core/src/types/index.ts` | Modify | ~15 | Low — additive type changes |
| `core/src/sops/client.ts` | Modify | ~40 | **Medium** — touches encrypt, decrypt, rotate paths |
| `core/src/manifest/parser.ts` | Modify | ~25 | Low — additive validation |
| `core/src/migration/backend.ts` | Modify | 1 | Low — add mapping entry |
| `core/src/cloud/keyservice.ts` | New | ~80 | Medium — subprocess lifecycle |
| `core/src/cloud/resolver.ts` | New | ~45 | Low — follows established pattern |
| `core/src/cloud/credentials.ts` | New | ~40 | Low — file read/write |
| `cli/src/commands/pack.ts` | Modify | ~50 | Medium — new flags, flow branching |
| `cli/src/commands/cloud.ts` | New | ~150+ | **High** — device flow, browser, polling |
| `cli/src/index.ts` | Modify | 2 | Low — import + registration |

**Total new code:** ~315 lines across 3 new files
**Total modified code:** ~135 lines across 5 existing files
**Highest risk:** SopsClient changes (all SOPS paths now carry keyservice args) and `clef cloud init` (device flow complexity)
