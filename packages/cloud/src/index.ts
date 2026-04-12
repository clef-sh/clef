/**
 * @clef-sh/cloud — Clef Cloud integration.
 *
 * VCS-agnostic authentication (with pluggable providers), credentials
 * management, and Cloud API client for the Clef bot. Requires @clef-sh/core
 * as a peer.
 */

// ── Auth provider interface & registry ────────────────────────────────────
export type { AuthProvider, AuthProviderDeps, VcsProvider } from "./types";
export type { ClefCloudCredentials } from "./types";
export { resolveAuthProvider, DEFAULT_PROVIDER, PROVIDER_IDS } from "./providers";
export { gitHubAuthProvider } from "./providers";

// ── Credentials ───────────────────────────────────────────────────────────
export {
  readCloudCredentials,
  writeCloudCredentials,
  deleteCloudCredentials,
  isSessionExpired,
} from "./credentials";

// ── GitHub Device Flow (low-level) ────────────────────────────────────────
export {
  requestDeviceCode,
  pollGitHubAuth,
  exchangeGitHubToken,
  runDeviceFlow,
} from "./device-flow";
export type { DeviceCodeResult, DeviceFlowResult, DeviceFlowStatus } from "./device-flow";
export type {
  GitHubDeviceCodeResponse,
  GitHubAccessTokenResponse,
  ClefTokenExchangeResponse,
} from "./types";

// ── Clef Cloud API (provider-agnostic) ────────────────────────────────────
export { startInstall, pollInstall, pollInstallUntilComplete, getMe } from "./cloud-api";
export type { InstallStartResponse, InstallPollResponse, MeResponse } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────
export {
  CLOUD_DEFAULT_ENDPOINT,
  CLOUD_DEV_ENDPOINT,
  SESSION_TOKEN_LIFETIME_MS,
  GITHUB_DEVICE_FLOW_SCOPES,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_ACCESS_TOKEN_URL,
} from "./constants";

// ── Cloud report client & types ───────────────────────────────────────────
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

// ── Policy ────────────────────────────────────────────────────────────────
export { scaffoldPolicyFile, POLICY_FILE_PATH, POLICY_TEMPLATE } from "./policy";
export type { ScaffoldResult } from "./policy";
