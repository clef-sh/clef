/**
 * HTTP client for the Cloud pack endpoint.
 *
 * Used by `clef pack --remote` to send encrypted files to Cloud for packing.
 */
import * as fs from "fs";
import * as path from "path";
import type { ClefManifest, MatrixCell } from "@clef-sh/core";
import { MatrixManager } from "@clef-sh/core";
import { CLOUD_DEFAULT_ENDPOINT } from "./constants";

export interface RemotePackConfig {
  identity: string;
  environment: string;
  manifest: ClefManifest;
  repoRoot: string;
  ttl?: number;
}

export interface RemotePackResult {
  revision: string;
  artifactSize: number;
  identity: string;
  environment: string;
}

export class CloudPackClient {
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint ?? CLOUD_DEFAULT_ENDPOINT;
  }

  async pack(token: string, config: RemotePackConfig): Promise<RemotePackResult> {
    const matrixManager = new MatrixManager();
    const cells = matrixManager
      .resolveMatrix(config.manifest, config.repoRoot)
      .filter((c: MatrixCell) => c.environment === config.environment && c.exists);

    const formData = new FormData();

    const configJson = JSON.stringify({
      identity: config.identity,
      environment: config.environment,
      ...(config.ttl ? { ttl: config.ttl } : {}),
    });
    formData.append("config", new Blob([configJson], { type: "application/json" }));

    const manifestPath = path.join(config.repoRoot, "clef.yaml");
    const manifestContent = fs.readFileSync(manifestPath, "utf-8");
    formData.append("manifest", new Blob([manifestContent], { type: "text/yaml" }));

    for (const cell of cells) {
      const relPath = path.relative(config.repoRoot, cell.filePath);
      const content = fs.readFileSync(cell.filePath, "utf-8");
      formData.append(`files`, new Blob([content], { type: "text/yaml" }), relPath);
    }

    const res = await fetch(`${this.endpoint}/api/v1/cloud/pack`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cloud pack failed (${res.status}): ${body}`);
    }

    return (await res.json()) as RemotePackResult;
  }
}

/**
 * HTTP client for uploading a locally-packed artifact to Cloud.
 *
 * Used by `clef pack --push`.
 */
export class CloudArtifactClient {
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint ?? CLOUD_DEFAULT_ENDPOINT;
  }

  async upload(
    token: string,
    config: { identity: string; environment: string; artifactJson: string },
  ): Promise<void> {
    const res = await fetch(
      `${this.endpoint}/api/v1/cloud/artifacts/${config.identity}/${config.environment}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: config.artifactJson,
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Artifact upload failed (${res.status}): ${body}`);
    }
  }
}
