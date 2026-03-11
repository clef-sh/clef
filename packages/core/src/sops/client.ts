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
import * as YAML from "yaml";
import {
  ClefManifest,
  DecryptedFile,
  SopsDecryptionError,
  SopsEncryptionError,
  SopsKeyNotFoundError,
  SopsMetadata,
  SubprocessRunner,
} from "../types";
import { assertSops } from "../dependencies/checker";

function formatFromPath(filePath: string): "yaml" | "json" {
  return filePath.endsWith(".json") ? "json" : "yaml";
}

export class SopsClient {
  constructor(private readonly runner: SubprocessRunner) {}

  async decrypt(filePath: string): Promise<DecryptedFile> {
    await assertSops(this.runner);
    const fmt = formatFromPath(filePath);
    const result = await this.runner.run("sops", ["decrypt", "--output-type", fmt, filePath]);

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

  async encrypt(
    filePath: string,
    values: Record<string, string>,
    manifest: ClefManifest,
  ): Promise<void> {
    await assertSops(this.runner);
    const fmt = formatFromPath(filePath);
    const content = fmt === "json" ? JSON.stringify(values, null, 2) : YAML.stringify(values);
    const args = this.buildEncryptArgs(filePath, manifest);

    const result = await this.runner.run(
      "sops",
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
      },
    );

    if (result.exitCode !== 0) {
      throw new SopsEncryptionError(
        `Failed to encrypt '${filePath}': ${result.stderr.trim()}`,
        filePath,
      );
    }

    // Write the encrypted output to the file
    const writeResult = await this.runner.run("tee", [filePath], {
      stdin: result.stdout,
    });

    if (writeResult.exitCode !== 0) {
      throw new SopsEncryptionError(`Failed to write encrypted data to '${filePath}'.`, filePath);
    }
  }

  async reEncrypt(filePath: string, newKey: string): Promise<void> {
    await assertSops(this.runner);
    const result = await this.runner.run("sops", ["rotate", "-i", "--add-age", newKey, filePath]);

    if (result.exitCode !== 0) {
      throw new SopsEncryptionError(
        `Failed to re-encrypt '${filePath}': ${result.stderr.trim()}`,
        filePath,
      );
    }
  }

  async validateEncryption(filePath: string): Promise<boolean> {
    await assertSops(this.runner);
    try {
      await this.getMetadata(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(filePath: string): Promise<SopsMetadata> {
    await assertSops(this.runner);
    const result = await this.runner.run("sops", ["filestatus", filePath]);

    // filestatus returns JSON with encrypted status; if it fails, try parsing the file directly
    if (result.exitCode !== 0) {
      // Fall back to reading SOPS metadata from the encrypted file
      return this.parseMetadataFromFile(filePath);
    }

    return this.parseMetadataFromFile(filePath);
  }

  private async parseMetadataFromFile(filePath: string): Promise<SopsMetadata> {
    const catResult = await this.runner.run("cat", [filePath]);

    if (catResult.exitCode !== 0) {
      throw new SopsDecryptionError(
        `Could not read file '${filePath}' to extract SOPS metadata.`,
        filePath,
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = YAML.parse(catResult.stdout);
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

  private buildEncryptArgs(filePath: string, manifest: ClefManifest): string[] {
    const args: string[] = [];

    switch (manifest.sops.default_backend) {
      case "age":
        if (manifest.sops.age_key_file) {
          // age recipients need to be derived; for new files we use the key file
          // Interpretation: use SOPS_AGE_KEY_FILE env var rather than passing on command line
        }
        break;
      case "awskms":
        if (manifest.sops.aws_kms_arn) {
          args.push("--kms", manifest.sops.aws_kms_arn);
        }
        break;
      case "gcpkms":
        if (manifest.sops.gcp_kms_resource_id) {
          args.push("--gcp-kms", manifest.sops.gcp_kms_resource_id);
        }
        break;
      case "pgp":
        if (manifest.sops.pgp_fingerprint) {
          args.push("--pgp", manifest.sops.pgp_fingerprint);
        }
        break;
    }

    return args;
  }
}
