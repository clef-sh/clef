import {
  CloudApiError,
  CloudApiReport,
  CloudBatchPayload,
  CloudBatchResponse,
  CloudIntegrationResponse,
  CloudReportResponse,
} from "../types";

const DEFAULT_RETRY_DELAY_MS = 1000;

/**
 * HTTP client for the Clef Pro API.
 * Uses native `fetch()` (Node 18+). Retries once on 5xx or network errors.
 */
export class CloudClient {
  private readonly retryDelayMs: number;

  constructor(options?: { retryDelayMs?: number }) {
    this.retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }
  async fetchIntegration(
    apiUrl: string,
    apiKey: string,
    integrationId: string,
  ): Promise<CloudIntegrationResponse> {
    const url = `${apiUrl}/api/v1/integrations/${encodeURIComponent(integrationId)}`;
    return this.request<CloudIntegrationResponse>("GET", url, apiKey);
  }

  async submitReport(
    apiUrl: string,
    apiKey: string,
    report: CloudApiReport,
  ): Promise<CloudReportResponse> {
    const url = `${apiUrl}/api/v1/reports`;
    return this.request<CloudReportResponse>("POST", url, apiKey, report);
  }

  async submitBatchReports(
    apiUrl: string,
    apiKey: string,
    batch: CloudBatchPayload,
  ): Promise<CloudBatchResponse> {
    const url = `${apiUrl}/api/v1/reports/batch`;
    return this.request<CloudBatchResponse>("POST", url, apiKey, batch);
  }

  private async request<T>(
    method: string,
    url: string,
    apiKey: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    const init: RequestInit = {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      // Network error — retry once
      await this.delay(this.retryDelayMs);
      try {
        response = await fetch(url, init);
      } catch (retryErr) {
        throw new CloudApiError(
          `Network error contacting Clef Pro: ${(retryErr as Error).message}`,
          0,
          "Check your network connection and CLEF_API_URL.",
        );
      }
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    // 5xx — retry once
    if (response.status >= 500 && response.status < 600) {
      await this.delay(this.retryDelayMs);
      const retryResponse = await fetch(url, init);
      if (retryResponse.ok) {
        return (await retryResponse.json()) as T;
      }
      throw this.buildError(retryResponse);
    }

    // 4xx — do not retry
    throw this.buildError(response);
  }

  private buildError(response: Response): CloudApiError {
    const hint =
      response.status === 401 || response.status === 403
        ? "Check your API token (--api-token or CLEF_API_TOKEN)."
        : response.status === 404
          ? "Check your cloud.integrationId in clef.yaml."
          : undefined;

    return new CloudApiError(
      `Clef Pro API returned ${response.status} ${response.statusText}`,
      response.status,
      hint,
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
