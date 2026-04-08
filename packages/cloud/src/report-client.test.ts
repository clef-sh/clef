import { CloudApiError, type CloudApiReport, type CloudBatchPayload } from "./types";
import { CloudClient } from "./report-client";

const mockFetch = jest.fn();
global.fetch = mockFetch;

function makeReport(): CloudApiReport {
  return {
    commitSha: "abc123",
    branch: "main",
    commitTimestamp: Date.now(),
    cliVersion: "1.0.0",
    summary: {
      filesScanned: 1,
      namespaces: ["db"],
      environments: ["dev"],
      cells: [{ namespace: "db", environment: "dev", healthStatus: "healthy", description: "ok" }],
      violations: 0,
      passed: true,
    },
    drift: [],
    policyResults: [],
  };
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function errorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({ message: "error" }),
  } as unknown as Response;
}

describe("CloudClient", () => {
  let client: CloudClient;

  beforeEach(() => {
    client = new CloudClient({ retryDelayMs: 0 });
    jest.clearAllMocks();
  });

  describe("fetchIntegration", () => {
    it("sends GET request with auth header", async () => {
      const body = { lastCommitSha: "def456", config: { collectCIContext: true } };
      mockFetch.mockResolvedValue(okResponse(body));

      const result = await client.fetchIntegration("https://api.clef.sh", "tok_abc", "int_123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.clef.sh/api/v1/integrations/int_123",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer tok_abc",
          }),
        }),
      );
      expect(result.lastCommitSha).toBe("def456");
    });
  });

  describe("submitReport", () => {
    it("sends POST request with report body", async () => {
      const body = { id: "rpt_1", commitSha: "abc123" };
      mockFetch.mockResolvedValue(okResponse(body));
      const report = makeReport();

      const result = await client.submitReport("https://api.clef.sh", "tok_abc", report);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.clef.sh/api/v1/reports",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(report),
        }),
      );
      expect(result.id).toBe("rpt_1");
    });
  });

  describe("submitBatchReports", () => {
    it("sends POST to batch endpoint", async () => {
      const body = { accepted: 2, reportIds: ["rpt_1", "rpt_2"] };
      mockFetch.mockResolvedValue(okResponse(body));
      const batch: CloudBatchPayload = { reports: [makeReport(), makeReport()] };

      const result = await client.submitBatchReports("https://api.clef.sh", "tok_abc", batch);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.clef.sh/api/v1/reports/batch",
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.accepted).toBe(2);
    });
  });

  describe("error handling", () => {
    it("throws CloudApiError on 4xx without retry", async () => {
      mockFetch.mockResolvedValue(errorResponse(403, "Forbidden"));

      await expect(
        client.fetchIntegration("https://api.clef.sh", "bad_tok", "int_1"),
      ).rejects.toThrow(CloudApiError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("includes auth hint on 401", async () => {
      mockFetch.mockResolvedValue(errorResponse(401, "Unauthorized"));

      try {
        await client.submitReport("https://api.clef.sh", "bad", makeReport());
        fail("expected error");
      } catch (err) {
        expect(err).toBeInstanceOf(CloudApiError);
        expect((err as CloudApiError).fix).toContain("API token");
      }
    });

    it("includes integrationId hint on 404", async () => {
      mockFetch.mockResolvedValue(errorResponse(404, "Not Found"));

      try {
        await client.fetchIntegration("https://api.clef.sh", "tok", "bad_id");
        fail("expected error");
      } catch (err) {
        expect(err).toBeInstanceOf(CloudApiError);
        expect((err as CloudApiError).fix).toContain("integrationId");
      }
    });

    it("retries once on 5xx then succeeds", async () => {
      const body = { lastCommitSha: null, config: { collectCIContext: false } };
      mockFetch
        .mockResolvedValueOnce(errorResponse(502, "Bad Gateway"))
        .mockResolvedValueOnce(okResponse(body));

      const result = await client.fetchIntegration("https://api.clef.sh", "tok", "int_1");

      expect(result.lastCommitSha).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries once on 5xx and throws if still failing", async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(503, "Service Unavailable"))
        .mockResolvedValueOnce(errorResponse(503, "Service Unavailable"));

      await expect(client.fetchIntegration("https://api.clef.sh", "tok", "int_1")).rejects.toThrow(
        CloudApiError,
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries once on network error then succeeds", async () => {
      const body = { id: "rpt_1", commitSha: "abc" };
      mockFetch
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce(okResponse(body));

      const result = await client.submitReport("https://api.clef.sh", "tok", makeReport());

      expect(result.id).toBe("rpt_1");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws CloudApiError on double network failure", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(client.submitReport("https://api.clef.sh", "tok", makeReport())).rejects.toThrow(
        CloudApiError,
      );
    });
  });
});
