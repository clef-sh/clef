/**
 * GitHub Device Flow (RFC 8628) client for Clef Cloud authentication.
 *
 * The CLI authenticates using GitHub's native Device Flow:
 * 1. Request a device code from GitHub
 * 2. Display the user code and open the verification URL
 * 3. Poll GitHub until the user enters the code
 * 4. Exchange the GitHub access token for a Clef session JWT
 */
import {
  GITHUB_DEVICE_CODE_URL,
  GITHUB_ACCESS_TOKEN_URL,
  GITHUB_DEVICE_FLOW_SCOPES,
  SESSION_TOKEN_LIFETIME_MS,
} from "./constants";
import type {
  GitHubDeviceCodeResponse,
  GitHubAccessTokenResponse,
  ClefTokenExchangeResponse,
  ClefCloudCredentials,
} from "./types";

/** Result of requesting a device code from GitHub. */
export interface DeviceCodeResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DeviceFlowStatus = "success" | "expired" | "access_denied";

/** Result of completing the full device flow (GitHub + Clef token exchange). */
export interface DeviceFlowResult {
  status: DeviceFlowStatus;
  credentials?: ClefCloudCredentials;
}

/**
 * Step 1: Request a device code from GitHub.
 */
export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResult> {
  const res = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: GITHUB_DEVICE_FLOW_SCOPES,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub device code request failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as GitHubDeviceCodeResponse;
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

/**
 * Step 3: Poll GitHub until the user completes authorization.
 *
 * Returns the GitHub access token on success, or a terminal status.
 */
export async function pollGitHubAuth(
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresIn: number,
): Promise<{ status: "success"; accessToken: string } | { status: "expired" | "access_denied" }> {
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalSeconds * 1000);

    const res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub token poll failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as GitHubAccessTokenResponse & { error?: string };

    if (data.error === "authorization_pending") {
      continue;
    }
    if (data.error === "slow_down") {
      // GitHub is asking us to back off — increase interval by 5 seconds per spec
      intervalSeconds += 5;
      continue;
    }
    if (data.error === "expired_token") {
      return { status: "expired" };
    }
    if (data.error === "access_denied") {
      return { status: "access_denied" };
    }
    if (data.error) {
      throw new Error(`GitHub device flow error: ${data.error}`);
    }

    // Success — we have an access token
    return { status: "success", accessToken: data.access_token };
  }

  return { status: "expired" };
}

/**
 * Step 4: Exchange a GitHub OAuth access token for a Clef session JWT.
 */
export async function exchangeGitHubToken(
  baseUrl: string,
  githubAccessToken: string,
): Promise<ClefCloudCredentials> {
  const res = await fetch(`${baseUrl}/api/v1/auth/github/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: githubAccessToken }),
  });

  if (!res.ok) {
    if (res.status >= 500) {
      throw new Error("Authentication failed. Try again later.");
    }
    const body = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as ClefTokenExchangeResponse;
  if (!json.success) {
    throw new Error(
      `Token exchange failed: ${(json as { message?: string }).message ?? "unknown error"}`,
    );
  }

  const expiresAt = new Date(Date.now() + SESSION_TOKEN_LIFETIME_MS).toISOString();

  return {
    session_token: json.data.session_token,
    login: json.data.user.login,
    email: json.data.user.email,
    expires_at: expiresAt,
    base_url: baseUrl,
    provider: "github",
  };
}

/**
 * Run the full GitHub Device Flow: request code, poll for auth, exchange token.
 *
 * The caller is responsible for displaying the user code and opening the browser.
 * This function yields control back after requesting the device code so the caller
 * can display the code, then resumes polling.
 */
export async function runDeviceFlow(
  clientId: string,
  baseUrl: string,
  onDeviceCode: (result: DeviceCodeResult) => void | Promise<void>,
): Promise<DeviceFlowResult> {
  const code = await requestDeviceCode(clientId);
  await onDeviceCode(code);

  const authResult = await pollGitHubAuth(clientId, code.deviceCode, code.interval, code.expiresIn);

  if (authResult.status !== "success") {
    return { status: authResult.status };
  }

  const credentials = await exchangeGitHubToken(baseUrl, authResult.accessToken);
  return { status: "success", credentials };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
