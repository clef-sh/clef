/** Supported VCS provider identifiers. */
export type VcsProvider = "github" | "gitlab" | "bitbucket";

/** User-scoped Cloud credentials stored in ~/.clef/cloud-credentials.json. */
export interface ClefCloudCredentials {
  /** Clef session JWT obtained by exchanging a VCS provider OAuth token. */
  session_token: string;
  /** VCS login / username (e.g. "jamesspears"). */
  login: string;
  /** Email address from the VCS provider profile. */
  email: string;
  /** ISO 8601 timestamp when the session token expires. */
  expires_at: string;
  /** Clef Cloud API base URL. */
  base_url: string;
  /** Which VCS provider was used to authenticate. Defaults to "github". */
  provider: VcsProvider;
}

// ── Auth provider interface ───────────────────────────────────────────────

/** Dependencies available to auth providers during login. */
export interface AuthProviderDeps {
  formatter: {
    print(msg: string): void;
    success(msg: string): void;
    error(msg: string): void;
    info(msg: string): void;
  };
  openBrowser(url: string): Promise<boolean>;
}

/**
 * Auth provider abstraction. Each VCS provider implements this to handle
 * its specific OAuth flow and exchange the resulting token for a Clef session.
 */
export interface AuthProvider {
  /** Provider identifier (e.g. "github"). */
  readonly id: VcsProvider;
  /** Human-readable name for CLI output (e.g. "GitHub"). */
  readonly displayName: string;
  /**
   * Run the full authentication flow for this provider.
   * Returns credentials on success, or null if the user cancelled / timed out.
   */
  login(baseUrl: string, deps: AuthProviderDeps): Promise<ClefCloudCredentials | null>;
}

// ── GitHub Device Flow types ──────────────────────────────────────────────

/** Response from GitHub's POST /login/device/code endpoint. */
export interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/** Response from GitHub's POST /login/oauth/access_token (success). */
export interface GitHubAccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

/** Response from Clef backend POST /api/v1/auth/github/token. */
export interface ClefTokenExchangeResponse {
  data: {
    session_token: string;
    user: {
      id: string;
      login: string;
      email: string;
    };
  };
  success: true;
}

// ── Install flow types ────────────────────────────────────────────────────

/** Response from POST /api/v1/install/start. */
export interface InstallStartResponse {
  data: {
    install_url: string;
    state: string;
    expires_in: number;
  };
  success: true;
}

/** Response from GET /api/v1/install/poll. */
export interface InstallPollResponse {
  data: {
    status: "pending" | "complete";
    installation?: {
      id: number;
      account: string;
      installedAt: number;
    };
  };
  success: true;
}

// ── /me endpoint types ────────────────────────────────────────────────────

/** Response from GET /api/v1/me. */
export interface MeResponse {
  data: {
    user: { id: string; login: string; email: string };
    installation: {
      id: number;
      account: string;
      installedAt: number;
    } | null;
    subscription: {
      tier: string;
      status: string;
    };
  };
  success: true;
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
