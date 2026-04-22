import { ClefClientError } from "./types";

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  token: string;
  fetchFn: typeof globalThis.fetch;
}

/**
 * Make an authenticated HTTP request to a Clef endpoint.
 * Handles the { data, success, message } envelope and retries once on 5xx.
 */
export async function request<T>(baseUrl: string, opts: RequestOptions): Promise<T> {
  const url = `${baseUrl}${opts.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    Accept: "application/json",
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const init: RequestInit = {
    method: opts.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };

  let response: Response;
  try {
    response = await opts.fetchFn(url, init);
  } catch (err) {
    // Retry once on network error
    try {
      response = await opts.fetchFn(url, init);
    } catch {
      throw new ClefClientError(
        `Connection failed: ${(err as Error).message}`,
        undefined,
        "Is the endpoint reachable? Check your CLEF_ENDPOINT setting.",
      );
    }
  }

  // Retry once on 5xx
  if (response.status >= 500) {
    response = await opts.fetchFn(url, init);
  }

  if (response.status === 401) {
    throw new ClefClientError("Authentication failed", 401, "Check your CLEF_AGENT_TOKEN.");
  }

  if (response.status === 503) {
    throw new ClefClientError("Secrets expired or not loaded", 503, "Check the agent logs.");
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ClefClientError(
      `HTTP ${response.status}: ${text || response.statusText}`,
      response.status,
    );
  }

  const json = (await response.json()) as { success?: unknown; message?: unknown; data?: T };

  // Unwrap { data, success, message } envelope if present
  if (json && typeof json === "object" && "success" in json) {
    if (!json.success) {
      const msg = typeof json.message === "string" ? json.message : "Request failed";
      throw new ClefClientError(msg, response.status);
    }
    return json.data as T;
  }

  return json as T;
}
