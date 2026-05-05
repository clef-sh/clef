/**
 * TIER 1 MODULE — Security and correctness critical.
 *
 * This module requires exhaustive test coverage. Before
 * adding or modifying code here:
 *   1. Add tests for the happy path
 *   2. Add tests for all documented error paths
 *   3. Add at least one boundary/edge case test
 *
 * Coverage threshold: 95% lines/functions, 90% branches.
 * See docs/contributing/testing.md for the rationale.
 */
import * as fs from "fs";
import * as net from "net";
import { randomBytes } from "crypto";
import * as YAML from "yaml";
import {
  BackendType,
  ClefManifest,
  DecryptedFile,
  MergeDecrypter,
  SopsDecryptionError,
  SopsEncryptionError,
  SopsKeyNotFoundError,
  SopsMetadata,
  SubprocessRunner,
  resolveBackendConfig,
  resolveRecipientsForEnvironment,
} from "../types";
import type {
  EncryptionBackend,
  EncryptionContext,
  RotateOptions,
} from "../source/encryption-backend";
import { assertSops } from "../dependencies/checker";
import { deriveAgePublicKey } from "../age/keygen";
import { resolveSopsPath } from "./resolver";
import { isClefHsmArn, pkcs11UriToSyntheticArn, syntheticArnToPkcs11Uri } from "./hsm-arn";

function formatFromPath(filePath: string): "yaml" | "json" {
  return filePath.endsWith(".json") ? "json" : "yaml";
}

/**
 * Resolve the right input-arg + stdin handling for piping `content` to a
 * SOPS subprocess. On Unix returns `/dev/stdin` and feeds via the runner's
 * stdin. On Windows opens a named pipe (which Go's CreateFile can read as
 * a file) and feeds via the pipe server; stdin on the runner is unused.
 *
 * Cleanup must always be invoked in a finally block — the Windows server
 * holds an open handle until closed.
 */
async function openInputPipe(
  content: string,
): Promise<{ inputArg: string; cleanup: () => void; runnerStdin?: string }> {
  if (process.platform === "win32") {
    const pipe = await openWindowsInputPipe(content);
    return { inputArg: pipe.inputArg, cleanup: pipe.cleanup };
  }
  return { inputArg: "/dev/stdin", cleanup: () => {}, runnerStdin: content };
}

/**
 * Path used as `--config` to bypass `.sops.yaml` creation rules. Clef
 * passes recipients/backend explicitly via flags, so no creation rules
 * are needed. Windows has no `/dev/null`; SOPS accepts `NUL`.
 */
function nullConfigPath(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

/**
 * On Windows, /dev/stdin does not exist. Create a named pipe that sops can open
 * as its input file, feed the content through it, and return the pipe path.
 * The returned cleanup function closes the server once sops is done reading.
 *
 * Go's os.Open / CreateFile can open \\.\pipe\... paths directly, so sops
 * reads from the pipe exactly as it would from a regular file.
 */
function openWindowsInputPipe(content: string): Promise<{ inputArg: string; cleanup: () => void }> {
  const pipeName = `\\\\.\\pipe\\clef-sops-${randomBytes(8).toString("hex")}`;

  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      // On Windows, socket.end() does not reliably signal EOF to named pipe
      // clients because libuv's uv_shutdown is a no-op for pipes. Write the
      // content and then force-destroy the socket so the pipe handle is closed,
      // which the Go client (sops) sees as ERROR_BROKEN_PIPE → io.EOF.
      socket.write(content, () => {
        socket.destroy();
      });
    });
    server.maxConnections = 1;
    server.on("error", reject);
    server.listen(pipeName, () => {
      resolve({
        inputArg: pipeName,
        cleanup: () => server.close(),
      });
    });
  });
}

/**
 * Wraps the `sops` binary for encryption, decryption, rotation, and metadata
 * extraction. All blob operations are piped via stdin/stdout — plaintext
 * never touches disk.
 *
 * `SopsClient` implements {@link EncryptionBackend} directly — pass it
 * straight to `composeSecretSource(storage, client, manifest)` without
 * any adapter. The legacy file-path methods (`encrypt(filePath, ...)`,
 * `addRecipient`, `removeRecipient`, `reEncrypt`,
 * `validateEncryption(filePath)`, `getMetadata(filePath)`) were removed
 * in Phase 7. The only remaining file-path entry point is
 * {@link decryptFile}, kept for the merge driver which receives temp
 * file paths from git — the contract for that surface is
 * {@link MergeDecrypter}.
 *
 * @example
 * ```ts
 * const client = new SopsClient(runner, "/home/user/.age/key.txt");
 * const source = composeSecretSource(
 *   new FilesystemStorageBackend(manifest, repoRoot),
 *   client,
 *   manifest,
 * );
 * const cell = await source.readCell({ namespace: "db", environment: "prod" });
 * ```
 */
export class SopsClient implements EncryptionBackend, MergeDecrypter {
  /** {@link EncryptionBackend} identifier. */
  readonly id = "sops";
  /** {@link EncryptionBackend} short description (used by `clef doctor`). */
  readonly description = "SOPS-based encryption via the bundled `sops` binary";

  private readonly sopsCommand: string;
  private readonly keyserviceArgs: readonly string[];

  /**
   * @param runner - Subprocess runner used to invoke the `sops` binary.
   * @param ageKeyFile - Optional path to an age private key file. Passed as
   *   `SOPS_AGE_KEY_FILE` to the subprocess environment.
   * @param ageKey - Optional inline age private key. Passed as `SOPS_AGE_KEY`
   *   to the subprocess environment.
   * @param sopsPath - Optional explicit path to the sops binary. When omitted,
   *   resolved automatically via {@link resolveSopsPath}.
   * @param keyserviceAddr - Optional address of an external SOPS KeyService
   *   sidecar (e.g. `tcp://127.0.0.1:12345`). When set, every SOPS invocation
   *   includes `--enable-local-keyservice=false --keyservice <addr>` so KMS
   *   wrap/unwrap is routed to the sidecar (used for the HSM backend, where
   *   the sidecar is `clef-keyservice` talking PKCS#11 to the HSM).
   *
   *   The flags are inserted **after** the SOPS subcommand — placing them
   *   before is silently ignored by SOPS (a footgun discovered the first
   *   time we shipped this).
   */
  constructor(
    private readonly runner: SubprocessRunner,
    private readonly ageKeyFile?: string,
    private readonly ageKey?: string,
    sopsPath?: string,
    keyserviceAddr?: string,
  ) {
    this.sopsCommand = sopsPath ?? resolveSopsPath().path;
    this.keyserviceArgs = keyserviceAddr
      ? Object.freeze(["--enable-local-keyservice=false", "--keyservice", keyserviceAddr])
      : Object.freeze([]);
  }

  private buildSopsEnv(): Record<string, string> | undefined {
    const env: Record<string, string> = {};
    if (this.ageKey) {
      env.SOPS_AGE_KEY = this.ageKey;
    }
    if (this.ageKeyFile) {
      env.SOPS_AGE_KEY_FILE = this.ageKeyFile;
    }
    return Object.keys(env).length > 0 ? env : undefined;
  }

  /**
   * Decrypt a SOPS-encrypted file by path. The only remaining file-path
   * entry point on this class — kept for the merge driver, which
   * receives temp filesystem paths from git that don't map onto a
   * `CellRef`. Production `SecretSource` consumers should call
   * `source.readCell` instead.
   *
   * @param filePath - Path to the `.enc.yaml` or `.enc.json` file.
   * @returns {@link DecryptedFile} with plaintext values in memory only.
   * @throws {@link SopsKeyNotFoundError} If no matching decryption key is available.
   * @throws {@link SopsDecryptionError} On any other decryption failure.
   */
  async decryptFile(filePath: string): Promise<DecryptedFile> {
    await assertSops(this.runner, this.sopsCommand);
    const fmt = formatFromPath(filePath);
    const env = this.buildSopsEnv();
    const result = await this.runner.run(
      this.sopsCommand,
      ["decrypt", ...this.keyserviceArgs, "--output-type", fmt, filePath],
      {
        ...(env ? { env } : {}),
      },
    );

    if (result.exitCode !== 0) {
      const errorType = await this.classifyDecryptError(filePath);
      if (errorType === "key-not-found") {
        throw new SopsKeyNotFoundError(
          `No decryption key found for '${filePath}'. ${result.stderr.trim()}`,
        );
      }
      throw new SopsDecryptionError(
        `Failed to decrypt '${filePath}': ${result.stderr.trim()}`,
        filePath,
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = YAML.parse(result.stdout) ?? {};
    } catch {
      throw new SopsDecryptionError(
        `Decrypted content of '${filePath}' is not valid YAML.`,
        filePath,
      );
    }

    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      values[key] = String(value);
    }

    // decrypt() is now the only public file-path method; populate metadata
    // by reading the cipher's plaintext SOPS block directly rather than
    // shelling out a second time. parseMetadataFromFile is private — the
    // blob-shaped getMetadataFromBlob is the substrate-agnostic surface.
    const metadata = this.parseMetadataFromFile(filePath);

    return { values, metadata };
  }

  /**
   * Determine whether a decrypt failure is caused by a missing/mismatched key (vs. some other
   * SOPS error) without relying on stderr message text.
   *
   * For age backends: reads the file's recipient list and checks whether any of the configured
   * private keys derive to a matching public key. For non-age backends (pgp, kms) we cannot
   * perform an equivalent check, so those always return "other".
   */
  private async classifyDecryptError(filePath: string): Promise<"key-not-found" | "other"> {
    let metadata: SopsMetadata;
    try {
      metadata = this.parseMetadataFromFile(filePath);
    } catch {
      return "other";
    }

    if (metadata.backend !== "age") return "other";

    // No age key configured at all
    if (!this.ageKey && !this.ageKeyFile) return "key-not-found";

    // Obtain the private key material from the constructor params
    let keyContent: string;
    try {
      keyContent = this.ageKey ?? fs.readFileSync(this.ageKeyFile!, "utf-8");
    } catch {
      return "key-not-found";
    }

    // Key files may contain multiple AGE-SECRET-KEY-1... lines (plus comments/blank lines)
    const privateKeys = keyContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("AGE-SECRET-KEY-"));

    if (privateKeys.length === 0) return "key-not-found";

    try {
      const publicKeys = await Promise.all(privateKeys.map((k) => deriveAgePublicKey(k)));
      const recipients = new Set(metadata.recipients);
      return publicKeys.some((pk) => recipients.has(pk)) ? "other" : "key-not-found";
    } catch {
      return "other";
    }
  }

  private parseMetadataFromFile(filePath: string): SopsMetadata {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      throw new SopsDecryptionError(
        `Could not read file '${filePath}' to extract SOPS metadata.`,
        filePath,
      );
    }
    return this.parseMetadataFromContent(content, filePath);
  }

  /**
   * Parse SOPS metadata from a string (no IO). Used by both
   * `parseMetadataFromFile` (after reading from disk) and the blob-shaped
   * `getMetadataFromBlob` (which receives ciphertext directly from a
   * BlobStore). The `label` is woven into error messages so callers can
   * include the file path or cell ref the content came from.
   */
  private parseMetadataFromContent(content: string, label: string): SopsMetadata {
    let parsed: Record<string, unknown>;
    try {
      parsed = YAML.parse(content);
    } catch {
      throw new SopsDecryptionError(
        `${label} is not valid YAML. Cannot extract SOPS metadata.`,
        label,
      );
    }

    const sops = parsed?.sops as Record<string, unknown> | undefined;
    if (!sops) {
      throw new SopsDecryptionError(
        `${label} does not contain SOPS metadata. It may not be encrypted.`,
        label,
      );
    }

    const backend = this.detectBackend(sops);
    const recipients = this.extractRecipients(sops, backend);
    const lastModifiedRaw = typeof sops.lastmodified === "string" ? sops.lastmodified : undefined;
    const lastModified = lastModifiedRaw ? new Date(lastModifiedRaw) : new Date();
    const lastModifiedPresent = lastModifiedRaw !== undefined;
    const version = typeof sops.version === "string" ? sops.version : undefined;

    return { backend, recipients, lastModified, lastModifiedPresent, version };
  }

  private detectBackend(sops: Record<string, unknown>): BackendType {
    if (sops.age && Array.isArray(sops.age) && (sops.age as unknown[]).length > 0) return "age";
    if (sops.kms && Array.isArray(sops.kms) && (sops.kms as unknown[]).length > 0) {
      // HSM uses SOPS's KMS slot but stamps a Clef synthetic ARN. The
      // alias/clef-hsm/v* marker is how we distinguish from real AWS KMS.
      const kmsEntries = sops.kms as Array<Record<string, unknown>>;
      const firstArn = kmsEntries[0]?.arn;
      if (typeof firstArn === "string" && isClefHsmArn(firstArn)) {
        return "hsm";
      }
      return "awskms";
    }
    if (sops.gcp_kms && Array.isArray(sops.gcp_kms) && (sops.gcp_kms as unknown[]).length > 0)
      return "gcpkms";
    if (sops.azure_kv && Array.isArray(sops.azure_kv) && (sops.azure_kv as unknown[]).length > 0)
      return "azurekv";
    if (sops.pgp && Array.isArray(sops.pgp) && (sops.pgp as unknown[]).length > 0) return "pgp";
    return "age"; // Interpretation: default to age when metadata is ambiguous
  }

  private extractRecipients(sops: Record<string, unknown>, backend: BackendType): string[] {
    switch (backend) {
      case "age": {
        const entries = sops.age as Array<Record<string, unknown>> | undefined;
        return entries?.map((e) => String(e.recipient ?? "")) ?? [];
      }
      case "awskms": {
        const entries = sops.kms as Array<Record<string, unknown>> | undefined;
        return entries?.map((e) => String(e.arn ?? "")) ?? [];
      }
      case "hsm": {
        // HSM entries live in the same `sops.kms[]` slot as AWS KMS but
        // carry a Clef synthetic ARN. Surface the decoded pkcs11 URI so
        // policy/lint/UI consumers see a meaningful identifier rather
        // than the opaque base64url payload.
        const entries = sops.kms as Array<Record<string, unknown>> | undefined;
        return (
          entries?.map((e) => {
            const raw = String(e.arn ?? "");
            return syntheticArnToPkcs11Uri(raw) ?? raw;
          }) ?? []
        );
      }
      case "gcpkms": {
        const entries = sops.gcp_kms as Array<Record<string, unknown>> | undefined;
        return entries?.map((e) => String(e.resource_id ?? "")) ?? [];
      }
      case "azurekv": {
        const entries = sops.azure_kv as Array<Record<string, unknown>> | undefined;
        return (
          entries?.map((e) => {
            const vaultUrl = String(e.vaultUrl ?? e.vault_url ?? "");
            const name = String(e.name ?? e.key ?? "");
            // Return the composite Key Vault key identifier
            return vaultUrl && name ? `${vaultUrl}/keys/${name}` : vaultUrl || name;
          }) ?? []
        );
      }
      case "pgp": {
        const entries = sops.pgp as Array<Record<string, unknown>> | undefined;
        return entries?.map((e) => String(e.fp ?? "")) ?? [];
      }
    }
  }

  private buildEncryptArgs(manifest: ClefManifest, environment?: string): string[] {
    const args: string[] = [];

    const config = environment
      ? resolveBackendConfig(manifest, environment)
      : {
          backend: manifest.sops.default_backend,
          aws_kms_arn: manifest.sops.aws_kms_arn,
          gcp_kms_resource_id: manifest.sops.gcp_kms_resource_id,
          azure_kv_url: manifest.sops.azure_kv_url,
          pgp_fingerprint: manifest.sops.pgp_fingerprint,
          pkcs11_uri: manifest.sops.pkcs11_uri,
        };

    switch (config.backend) {
      case "age": {
        const envRecipients = environment
          ? resolveRecipientsForEnvironment(manifest, environment)
          : undefined;
        const recipients = envRecipients ?? manifest.sops.age?.recipients ?? [];
        const keys = recipients.map((r) => (typeof r === "string" ? r : r.key));
        if (keys.length > 0) {
          args.push("--age", keys.join(","));
        }
        break;
      }
      case "awskms":
        if (config.aws_kms_arn) {
          args.push("--kms", config.aws_kms_arn);
        }
        break;
      case "gcpkms":
        if (config.gcp_kms_resource_id) {
          args.push("--gcp-kms", config.gcp_kms_resource_id);
        }
        break;
      case "azurekv":
        if (config.azure_kv_url) {
          args.push("--azure-kv", config.azure_kv_url);
        }
        break;
      case "pgp":
        if (config.pgp_fingerprint) {
          args.push("--pgp", config.pgp_fingerprint);
        }
        break;
      case "hsm":
        if (config.pkcs11_uri) {
          // SOPS validates --kms against an AWS ARN regex before the
          // keyservice is ever called, so we wrap the pkcs11 URI in a
          // Clef synthetic ARN. The keyservice decodes it on the wire
          // and forwards the URI to the PKCS#11 backend.
          args.push("--kms", pkcs11UriToSyntheticArn(config.pkcs11_uri));
        }
        break;
    }

    return args;
  }

  // ── Blob-shaped methods ─────────────────────────────────────────────────
  //
  // These mirror the file-path methods above but operate on opaque
  // ciphertext bytes via SOPS' stdin/stdout. They are the substrate-
  // agnostic primitives used by the `composeSecretSource` factory to
  // wrap any `BlobStore` (filesystem, postgres, etc.) into a full
  // `SecretSource`. Plaintext never leaves the SOPS subprocess.

  /**
   * {@link EncryptionBackend.decrypt} — decrypt SOPS-encrypted bytes (e.g.
   * read from a `StorageBackend`) and return plaintext values + metadata.
   * Plaintext lives only in memory.
   */
  async decrypt(blob: string, ctx: EncryptionContext): Promise<DecryptedFile> {
    await assertSops(this.runner, this.sopsCommand);
    const env = this.buildSopsEnv();
    const pipe = await openInputPipe(blob);

    let result;
    try {
      result = await this.runner.run(
        this.sopsCommand,
        [
          "decrypt",
          ...this.keyserviceArgs,
          "--input-type",
          ctx.format,
          "--output-type",
          ctx.format,
          pipe.inputArg,
        ],
        {
          ...(pipe.runnerStdin !== undefined ? { stdin: pipe.runnerStdin } : {}),
          ...(env ? { env } : {}),
        },
      );
    } finally {
      pipe.cleanup();
    }

    if (result.exitCode !== 0) {
      const errorType = await this.classifyDecryptErrorFromContent(blob);
      if (errorType === "key-not-found") {
        throw new SopsKeyNotFoundError(`No decryption key found for cell. ${result.stderr.trim()}`);
      }
      throw new SopsDecryptionError(`Failed to decrypt cell: ${result.stderr.trim()}`);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = YAML.parse(result.stdout) ?? {};
    } catch {
      throw new SopsDecryptionError("Decrypted content is not valid YAML.");
    }

    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      values[key] = String(value);
    }

    const metadata = this.parseMetadataFromContent(blob, "<cell>");
    return { values, metadata };
  }

  /**
   * {@link EncryptionBackend.encrypt} — encrypt plaintext values into a
   * SOPS-formatted ciphertext blob. Returns the bytes as a string;
   * caller (typically a `StorageBackend`) decides where to put them.
   * Plaintext is piped via stdin only.
   */
  async encrypt(values: Record<string, string>, ctx: EncryptionContext): Promise<string> {
    await assertSops(this.runner, this.sopsCommand);
    const content =
      ctx.format === "json" ? JSON.stringify(values, null, 2) : YAML.stringify(values);
    const args = this.buildEncryptArgs(ctx.manifest, ctx.environment);
    const env = this.buildSopsEnv();
    const pipe = await openInputPipe(content);

    let result;
    try {
      result = await this.runner.run(
        this.sopsCommand,
        [
          "--config",
          nullConfigPath(),
          "encrypt",
          ...this.keyserviceArgs,
          ...args,
          "--input-type",
          ctx.format,
          "--output-type",
          ctx.format,
          pipe.inputArg,
        ],
        {
          ...(pipe.runnerStdin !== undefined ? { stdin: pipe.runnerStdin } : {}),
          ...(env ? { env } : {}),
        },
      );
    } finally {
      pipe.cleanup();
    }

    if (result.exitCode !== 0) {
      throw new SopsEncryptionError(`Failed to encrypt cell: ${result.stderr.trim()}`);
    }

    return result.stdout;
  }

  /**
   * {@link EncryptionBackend.rotate} — add or remove recipients from an
   * encrypted SOPS blob via stdin/stdout. Drops the in-place `-i` flag
   * the deleted file-path-shaped methods used, so SOPS writes the
   * rotated ciphertext to stdout instead of back to a file. Plaintext
   * stays inside the SOPS subprocess; no plaintext window exists in
   * this Node process.
   *
   * Single SOPS invocation can both add and remove recipients
   * simultaneously (matches the CLI flag set).
   */
  async rotate(blob: string, opts: RotateOptions, ctx: EncryptionContext): Promise<string> {
    await assertSops(this.runner, this.sopsCommand);
    const env = this.buildSopsEnv();
    const pipe = await openInputPipe(blob);

    const flagArgs: string[] = [];
    if (opts.addAge) flagArgs.push("--add-age", opts.addAge);
    if (opts.rmAge) flagArgs.push("--rm-age", opts.rmAge);
    if (opts.addKms) flagArgs.push("--add-kms", opts.addKms);
    if (opts.rmKms) flagArgs.push("--rm-kms", opts.rmKms);
    if (opts.addGcpKms) flagArgs.push("--add-gcp-kms", opts.addGcpKms);
    if (opts.rmGcpKms) flagArgs.push("--rm-gcp-kms", opts.rmGcpKms);
    if (opts.addAzureKv) flagArgs.push("--add-azure-kv", opts.addAzureKv);
    if (opts.rmAzureKv) flagArgs.push("--rm-azure-kv", opts.rmAzureKv);
    if (opts.addPgp) flagArgs.push("--add-pgp", opts.addPgp);
    if (opts.rmPgp) flagArgs.push("--rm-pgp", opts.rmPgp);

    let result;
    try {
      result = await this.runner.run(
        this.sopsCommand,
        [
          "--config",
          nullConfigPath(),
          "rotate",
          ...this.keyserviceArgs,
          ...flagArgs,
          "--input-type",
          ctx.format,
          "--output-type",
          ctx.format,
          pipe.inputArg,
        ],
        {
          ...(pipe.runnerStdin !== undefined ? { stdin: pipe.runnerStdin } : {}),
          ...(env ? { env } : {}),
        },
      );
    } finally {
      pipe.cleanup();
    }

    if (result.exitCode !== 0) {
      throw new SopsEncryptionError(`Failed to rotate cell: ${result.stderr.trim()}`);
    }

    return result.stdout;
  }

  /**
   * {@link EncryptionBackend.getMetadata} — extract SOPS metadata from a
   * ciphertext blob without decrypting. Pure parser, no IO, no
   * subprocess.
   */
  getMetadata(content: string): SopsMetadata {
    return this.parseMetadataFromContent(content, "<cell>");
  }

  /**
   * {@link EncryptionBackend.validateEncryption} — whether `content` is a
   * valid SOPS-encrypted blob (parses + has the `sops:` metadata
   * block). Never throws.
   */
  validateEncryption(content: string): boolean {
    try {
      this.parseMetadataFromContent(content, "<cell>");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Blob-shaped variant of `classifyDecryptError`. Same logic as the
   * file-path version but reads metadata from the in-memory ciphertext
   * instead of disk.
   */
  private async classifyDecryptErrorFromContent(
    content: string,
  ): Promise<"key-not-found" | "other"> {
    let metadata: SopsMetadata;
    try {
      metadata = this.parseMetadataFromContent(content, "<cell>");
    } catch {
      return "other";
    }

    if (metadata.backend !== "age") return "other";
    if (!this.ageKey && !this.ageKeyFile) return "key-not-found";

    let keyContent: string;
    try {
      keyContent = this.ageKey ?? fs.readFileSync(this.ageKeyFile!, "utf-8");
    } catch {
      return "key-not-found";
    }

    const privateKeys = keyContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("AGE-SECRET-KEY-"));

    if (privateKeys.length === 0) return "key-not-found";

    try {
      const publicKeys = await Promise.all(privateKeys.map((k) => deriveAgePublicKey(k)));
      const recipients = new Set(metadata.recipients);
      return publicKeys.some((pk) => recipients.has(pk)) ? "other" : "key-not-found";
    } catch {
      return "other";
    }
  }
}
