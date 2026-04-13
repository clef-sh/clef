/**
 * Clef Cloud API client for the install flow and user status.
 */
import type { InstallStartResponse, InstallPollResponse, MeResponse } from "./types";

/**
 * Start a GitHub App installation flow.
 * Returns the install URL to open in the browser and a state token for polling.
 */
export async function startInstall(
  baseUrl: string,
  sessionToken: string,
): Promise<InstallStartResponse["data"]> {
  const res = await fetchWithRetry(`${baseUrl}/api/v1/install/start`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Install start failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as InstallStartResponse;
  return json.data;
}

/**
 * Poll for install completion by state token.
 */
export async function pollInstall(
  baseUrl: string,
  stateToken: string,
): Promise<InstallPollResponse["data"]> {
  const res = await fetch(`${baseUrl}/api/v1/install/poll?state=${encodeURIComponent(stateToken)}`);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Install poll failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as InstallPollResponse;
  return json.data;
}

/**
 * Poll install until complete or timeout.
 */
export async function pollInstallUntilComplete(
  baseUrl: string,
  stateToken: string,
  expiresIn: number,
  intervalMs = 2500,
): Promise<InstallPollResponse["data"]> {
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    const result = await pollInstall(baseUrl, stateToken);
    if (result.status === "complete") {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { status: "pending" };
}

/**
 * Get current user, installation, and subscription state.
 */
export async function getMe(baseUrl: string, sessionToken: string): Promise<MeResponse["data"]> {
  const res = await fetchWithRetry(`${baseUrl}/api/v1/me`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });

  if (res.status === 401) {
    throw new Error("Session expired. Run 'clef cloud login'.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Status request failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as MeResponse;
  return json.data;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500) return res;
      // 5xx — retry with backoff
      lastError = new Error(`Server error (${res.status})`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * Math.pow(2, attempt)));
    }
  }

  throw lastError ?? new Error("Request failed after retries");
}
