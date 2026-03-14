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
import * as YAML from "yaml";
import {
  ClefManifest,
  DecryptedFile,
  EncryptionBackend,
  SopsDecryptionError,
  SopsEncryptionError,
  SopsKeyNotFoundError,
  SopsMetadata,
  SubprocessRunner,
  resolveBackendConfig,
} from "../types";
import { assertSops } from "../dependencies/checker";
import { resolveSopsPath } from "./resolver";

function formatFromPath(filePath: string): "yaml" | "json" {
  return filePath.endsWith(".json") ? "json" : "yaml";
}

/**
 * Wraps the `sops` binary for encryption, decryption, re-encryption, and metadata extraction.
 * All decrypt/encrypt operations are piped via stdin/stdout — plaintext never touches disk.
 *
 * @example
 * ```ts
 * const client = new SopsClient(runner, "/home/user/.age/key.txt");
 * const decrypted = await client.decrypt("secrets/production.enc.yaml");
 * ```
 */
export class SopsClient implements EncryptionBackend {
  private readonly sopsCommand: string;

  /**
   * @param runner - Subprocess runner used to invoke the `sops` binary.
   * @param ageKeyFile - Optional path to an age private key file. Passed as
   *   `SOPS_AGE_KEY_FILE` to the subprocess environment.
   * @param ageKey - Optional inline age private key. Passed as `SOPS_AGE_KEY`
   *   to the subprocess environment.
   * @param sopsPath - Optional explicit path to the sops binary. When omitted,
   *   resolved automatically via {@link resolveSopsPath}.
   */
  constructor(
    private readonly runner: SubprocessRunner,
    private readonly ageKeyFile?: string,
    private readonly ageKey?: string,
    sopsPath?: string,
  ) {
    this.sopsCommand = sopsPath ?? resolveSopsPath().path;
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
   * Decrypt a SOPS-encrypted file and return its values and metadata.
   *
   * @param filePath - Path to the `.enc.yaml` or `.enc.json` file.
   * @returns {@link DecryptedFile} with plaintext values in memory only.
   * @throws {@link SopsKeyNotFoundError} If no matching decryption key is available.
   * @throws {@link SopsDecryptionError} On any other decryption failure.
   */
  async decrypt(filePath: string): Promise<DecryptedFile> {
    await assertSops(this.runner, this.sopsCommand);
    const fmt = formatFromPath(filePath);
    const env = this.buildSopsEnv();
    const result = await this.runner.run(
      this.sopsCommand,
      ["decrypt", "--output-type", fmt, filePath],
      {
        ...(env ? { env } : {}),
      },
    );

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toLowerCase();
      if (stderr.includes("could not find") || stderr.includes("no key")) {
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

    const metadata = await this.getMetadata(filePath);

    return { values, metadata };
  }

  /**
   * Encrypt a key/value map and write it to an encrypted SOPS file.
   *
   * @param filePath - Destination path for the encrypted file.
   * @param values - Flat key/value map to encrypt.
   * @param manifest - Manifest used to determine the encryption backend and key configuration.
   * @param environment - Optional environment name. When provided, per-env backend overrides
   *   are resolved from the manifest. When omitted, the global `sops.default_backend` is used.
   * @throws {@link SopsEncryptionError} On encryption or write failure.
   */
  async encrypt(
    filePath: string,
    values: Record<string, string>,
    manifest: ClefManifest,
    environment?: string,
  ): Promise<void> {
    await assertSops(this.runner, this.sopsCommand);
    const fmt = formatFromPath(filePath);
    const content = fmt === "json" ? JSON.stringify(values, null, 2) : YAML.stringify(values);
    const args = this.buildEncryptArgs(filePath, manifest, environment);
    const env = this.buildSopsEnv();

    const result = await this.runner.run(
      this.sopsCommand,
      [
        "encrypt",
        ...args,
        "--input-type",
        fmt,
        "--output-type",
        fmt,
        "--filename-override",
        filePath,
      ],
      {
        stdin: content,
        ...(env ? { env } : {}),
      },
    );

    if (result.exitCode !== 0) {
      throw new SopsEncryptionError(
        `Failed to encrypt '${filePath}': ${result.stderr.trim()}`,
        filePath,
      );
    }

    // Write the encrypted output to the file (using fs directly — tee is not available on Windows)
    try {
      fs.writeFileSync(filePath, result.stdout);
    } catch {
      throw new SopsEncryptionError(`Failed to write encrypted data to '${filePath}'.`, filePath);
    }
  }

  /**
   * Rotate encryption by adding a new age recipient key to an existing SOPS file.
   *
   * @param filePath - Path to the encrypted file to re-encrypt.
   * @param newKey - New age public key to add as a recipient.
   * @throws {@link SopsEncryptionError} On failure.
   */
  async reEncrypt(filePath: string, newKey: string): Promise<void> {
    await assertSops(this.runner, this.sopsCommand);
    const env = this.buildSopsEnv();
    const result = await this.runner.run(
      this.sopsCommand,
      ["rotate", "-i", "--add-age", newKey, filePath],
      {
        ...(env ? { env } : {}),
      },
    );

    if (result.exitCode !== 0) {
      throw new SopsEncryptionError(
        `Failed to re-encrypt '${filePath}': ${result.stderr.trim()}`,
        filePath,
      );
    }
  }

  /**
   * Add an age recipient to an existing SOPS file.
   *
   * @param filePath - Path to the encrypted file.
   * @param key - age public key to add as a recipient.
   * @throws {@link SopsEncryptionError} On failure.
   */
  async addRecipient(filePath: string, key: string): Promise<void> {
    await assertSops(this.runner, this.sopsCommand);
    const env = this.buildSopsEnv();
    const result = await this.runner.run(
      this.sopsCommand,
      ["rotate", "-i", "--add-age", key, filePath],
      {
        ...(env ? { env } : {}),
      },
    );

    if (result.exitCode !== 0) {
      throw new SopsEncryptionError(
        `Failed to add recipient to '${filePath}': ${result.stderr.trim()}`,
        filePath,
      );
    }
  }

  /**
   * Remove an age recipient from an existing SOPS file.
   *
   * @param filePath - Path to the encrypted file.
   * @param key - age public key to remove.
   * @throws {@link SopsEncryptionError} On failure.
   */
  async removeRecipient(filePath: string, key: string): Promise<void> {
    await assertSops(this.runner, this.sopsCommand);
    const env = this.buildSopsEnv();
    const result = await this.runner.run(
      this.sopsCommand,
      ["rotate", "-i", "--rm-age", key, filePath],
      {
        ...(env ? { env } : {}),
      },
    );

    if (result.exitCode !== 0) {
      throw new SopsEncryptionError(
        `Failed to remove recipient from '${filePath}': ${result.stderr.trim()}`,
        filePath,
      );
    }
  }

  /**
   * Check whether a file contains valid SOPS encryption metadata.
   *
   * @param filePath - Path to the file to check.
   * @returns `true` if valid SOPS metadata is present; `false` otherwise. Never throws.
   */
  async validateEncryption(filePath: string): Promise<boolean> {
    await assertSops(this.runner, this.sopsCommand);
    try {
      await this.getMetadata(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract SOPS metadata (backend, recipients, last-modified timestamp) from an encrypted file
   * without decrypting its values.
   *
   * @param filePath - Path to the encrypted file.
   * @returns {@link SopsMetadata} parsed from the file's `sops:` block.
   * @throws {@link SopsDecryptionError} If the file cannot be read or parsed.
   */
  async getMetadata(filePath: string): Promise<SopsMetadata> {
    await assertSops(this.runner, this.sopsCommand);
    const env = this.buildSopsEnv();
    const result = await this.runner.run(this.sopsCommand, ["filestatus", filePath], {
      ...(env ? { env } : {}),
    });

    // filestatus returns JSON with encrypted status; if it fails, try parsing the file directly
    if (result.exitCode !== 0) {
      // Fall back to reading SOPS metadata from the encrypted file
      return this.parseMetadataFromFile(filePath);
    }

    return this.parseMetadataFromFile(filePath);
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

    let parsed: Record<string, unknown>;
    try {
      parsed = YAML.parse(content);
    } catch {
      throw new SopsDecryptionError(
        `File '${filePath}' is not valid YAML. Cannot extract SOPS metadata.`,
        filePath,
      );
    }

    const sops = parsed?.sops as Record<string, unknown> | undefined;
    if (!sops) {
      throw new SopsDecryptionError(
        `File '${filePath}' does not contain SOPS metadata. It may not be encrypted.`,
        filePath,
      );
    }

    const backend = this.detectBackend(sops);
    const recipients = this.extractRecipients(sops, backend);
    const lastModified = sops.lastmodified ? new Date(sops.lastmodified as string) : new Date();

    return { backend, recipients, lastModified };
  }

  private detectBackend(sops: Record<string, unknown>): "age" | "awskms" | "gcpkms" | "pgp" {
    if (sops.age && Array.isArray(sops.age) && (sops.age as unknown[]).length > 0) return "age";
    if (sops.kms && Array.isArray(sops.kms) && (sops.kms as unknown[]).length > 0) return "awskms";
    if (sops.gcp_kms && Array.isArray(sops.gcp_kms) && (sops.gcp_kms as unknown[]).length > 0)
      return "gcpkms";
    if (sops.pgp && Array.isArray(sops.pgp) && (sops.pgp as unknown[]).length > 0) return "pgp";
    return "age"; // Interpretation: default to age when metadata is ambiguous
  }

  private extractRecipients(
    sops: Record<string, unknown>,
    backend: "age" | "awskms" | "gcpkms" | "pgp",
  ): string[] {
    switch (backend) {
      case "age": {
        const entries = sops.age as Array<Record<string, unknown>> | undefined;
        return entries?.map((e) => String(e.recipient ?? "")) ?? [];
      }
      case "awskms": {
        const entries = sops.kms as Array<Record<string, unknown>> | undefined;
        return entries?.map((e) => String(e.arn ?? "")) ?? [];
      }
      case "gcpkms": {
        const entries = sops.gcp_kms as Array<Record<string, unknown>> | undefined;
        return entries?.map((e) => String(e.resource_id ?? "")) ?? [];
      }
      case "pgp": {
        const entries = sops.pgp as Array<Record<string, unknown>> | undefined;
        return entries?.map((e) => String(e.fp ?? "")) ?? [];
      }
    }
  }

  private buildEncryptArgs(
    filePath: string,
    manifest: ClefManifest,
    environment?: string,
  ): string[] {
    const args: string[] = [];

    const config = environment
      ? resolveBackendConfig(manifest, environment)
      : {
          backend: manifest.sops.default_backend,
          aws_kms_arn: manifest.sops.aws_kms_arn,
          gcp_kms_resource_id: manifest.sops.gcp_kms_resource_id,
          pgp_fingerprint: manifest.sops.pgp_fingerprint,
        };

    switch (config.backend) {
      case "age":
        // Key injection is handled via buildSopsEnv() — no extra args needed here
        break;
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
      case "pgp":
        if (config.pgp_fingerprint) {
          args.push("--pgp", config.pgp_fingerprint);
        }
        break;
    }

    return args;
  }
}
