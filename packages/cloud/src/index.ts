/**
 * @clef-sh/cloud — Clef Cloud integration.
 *
 * Managed KMS backend, device-flow authentication, artifact hosting,
 * and keyservice sidecar management. Requires @clef-sh/core as a peer.
 *
 * This package is optional — the core Clef CLI works without it.
 * Install it to enable `clef cloud init` and the Cloud encryption backend.
 */

export type { ClefCloudCredentials } from "./types";
export { spawnKeyservice } from "./keyservice";
export type { KeyserviceHandle } from "./keyservice";
export { resolveKeyservicePath, resetKeyserviceResolution } from "./resolver";
export type { KeyserviceResolution, KeyserviceSource } from "./resolver";
export { readCloudCredentials, writeCloudCredentials } from "./credentials";
export { initiateDeviceFlow, pollDeviceFlow } from "./device-flow";
export type { DeviceSession, DevicePollResult } from "./device-flow";
export { CloudPackClient, CloudArtifactClient } from "./pack-client";
export type { RemotePackConfig, RemotePackResult } from "./pack-client";
export { CLOUD_DEFAULT_ENDPOINT } from "./constants";
export { createCloudSopsClient } from "./sops";
export type { CloudSopsResult, CreateSopsClientFn } from "./sops";
export { CloudClient } from "./report-client";
export type {
  CloudApiReport,
  CloudBatchPayload,
  CloudBatchResponse,
  CloudIntegrationResponse,
  CloudReportResponse,
  CloudReportSummary,
  CloudReportDrift,
  CloudReportCell,
  CloudCellHealthStatus,
  CloudPolicyResult,
  CloudCIContext,
} from "./types";
export { CloudApiError } from "./types";
