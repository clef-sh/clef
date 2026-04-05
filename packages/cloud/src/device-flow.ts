/**
 * Device flow client for Clef Cloud authentication.
 *
 * The CLI initiates a device flow session, opens the browser to the login URL,
 * and polls until the user completes auth + payment. Same pattern as
 * `gh auth login` and Claude Code.
 */
import { CLOUD_DEFAULT_ENDPOINT } from "./constants";

export interface DeviceSession {
  sessionId: string;
  loginUrl: string;
  pollUrl: string;
  /** Session lifetime in seconds. */
  expiresIn: number;
}

export interface DevicePollResult {
  status: "pending" | "awaiting_payment" | "complete" | "cancelled" | "expired";
  /** Cognito refresh token. Present when status is "complete". */
  token?: string;
  /** Present when status is "complete". */
  integrationId?: string;
  /** Present when status is "complete". */
  keyId?: string;
  /** Cognito OAuth2 domain URL for token refresh. Present when status is "complete". */
  cognitoDomain?: string;
  /** CLI Cognito app client ID. Present when status is "complete". */
  clientId?: string;
}

/**
 * Initiate a device flow session with the Cloud API.
 *
 * @param endpoint - Cloud API base URL. Defaults to https://api.clef.sh.
 * @param options - Session metadata carried into the browser flow.
 * @returns The session with a login URL to open in the browser.
 */
export async function initiateDeviceFlow(
  endpoint: string | undefined,
  options: { repoName: string; environment: string; clientVersion: string },
): Promise<DeviceSession> {
  const base = endpoint ?? CLOUD_DEFAULT_ENDPOINT;
  const res = await fetch(`${base}/api/v1/device/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientType: "cli",
      clientVersion: options.clientVersion,
      repoName: options.repoName,
      environment: options.environment,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Device flow init failed (${res.status}): ${body}`);
  }

  const json = await res.json();
  // Support both { data: { ... } } (saas API) and flat { ... } formats
  const session = (json.data ?? json) as DeviceSession;

  // The API may return a relative pollUrl — resolve it against the base
  if (session.pollUrl && !session.pollUrl.startsWith("http")) {
    session.pollUrl = `${base}${session.pollUrl}`;
  }

  return session;
}

/**
 * Poll a device flow session for completion.
 *
 * @param pollUrl - The full poll URL returned by {@link initiateDeviceFlow}.
 * @returns The current session state.
 */
export async function pollDeviceFlow(pollUrl: string): Promise<DevicePollResult> {
  const res = await fetch(pollUrl);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Device flow poll failed (${res.status}): ${body}`);
  }

  const json = await res.json();
  return (json.data ?? json) as DevicePollResult;
}
