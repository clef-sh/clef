/** User-scoped Cloud credentials stored in ~/.clef/credentials.yaml. */
export interface ClefCloudCredentials {
  /** Cognito refresh token — long-lived, auto-refreshed to get access tokens. */
  refreshToken: string;
  /** Cached Cognito access token — short-lived, refreshed as needed. */
  accessToken?: string;
  /** Epoch ms when the cached access token expires. */
  accessTokenExpiry?: number;
  /** Cloud API endpoint override. Defaults to https://api.clef.sh. */
  endpoint?: string;
  /** Cognito OAuth2 domain for token refresh (e.g. https://clefcloud-123.auth.us-east-1.amazoncognito.com). */
  cognitoDomain?: string;
  /** Cognito CLI app client ID. */
  clientId?: string;
}

// ── Cloud report types ─────────────────────────────────────────────────────

/** Health status for a single matrix cell in a cloud report. */
export type CloudCellHealthStatus = "healthy" | "warning" | "critical" | "unknown";

/** A single cell summary sent to the Cloud API. */
export interface CloudReportCell {
  namespace: string;
  environment: string;
  healthStatus: CloudCellHealthStatus;
  description: string;
}

/** Summary section of a cloud API report. */
export interface CloudReportSummary {
  filesScanned: number;
  namespaces: string[];
  environments: string[];
  cells: CloudReportCell[];
  violations: number;
  passed: boolean;
}

/** Drift entry for a single namespace in a cloud report. */
export interface CloudReportDrift {
  namespace: string;
  isDrifted: boolean;
  driftCount: number;
}

/** A single policy result in a cloud report. */
export interface CloudPolicyResult {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  severity: string;
  message: string;
  scope?: { namespace?: string; environment?: string };
}

/** CI context attached to cloud reports when collectCIContext is enabled. */
export interface CloudCIContext {
  provider: string;
  pipelineUrl?: string;
  trigger?: string;
}

/** The report payload sent to the Cloud API. */
export interface CloudApiReport {
  commitSha: string;
  branch: string;
  commitTimestamp: number;
  cliVersion: string;
  summary: CloudReportSummary;
  drift: CloudReportDrift[];
  policyResults: CloudPolicyResult[];
  ciContext?: CloudCIContext;
}

/** Batch payload for backfill submissions (max 500, oldest→newest). */
export interface CloudBatchPayload {
  reports: CloudApiReport[];
}

/** Response from GET /api/v1/integrations/:integrationId. */
export interface CloudIntegrationResponse {
  lastCommitSha: string | null;
  config: {
    collectCIContext: boolean;
  };
}

/** Response from POST /api/v1/reports. */
export interface CloudReportResponse {
  id: string;
  commitSha: string;
}

/** Response from POST /api/v1/reports/batch. */
export interface CloudBatchResponse {
  accepted: number;
  reportIds: string[];
}

/** Thrown when a Cloud API request fails. */
export class CloudApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly fix?: string,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}
