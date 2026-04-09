import { request } from "./http";
import { ClefClientError } from "./types";

function mockFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

describe("request", () => {
  it("returns data directly for flat responses", async () => {
    const fetch = mockFetch(200, { DB_URL: "postgres://localhost" });
    const result = await request<Record<string, string>>("http://localhost", {
      method: "GET",
      path: "/v1/secrets",
      token: "tok",
      fetchFn: fetch,
    });
    expect(result).toEqual({ DB_URL: "postgres://localhost" });
  });

  it("unwraps { data, success, message } envelope", async () => {
    const fetch = mockFetch(200, {
      data: { plaintext: "abc123" },
      success: true,
      message: "ok",
    });
    const result = await request<{ plaintext: string }>("http://localhost", {
      method: "POST",
      path: "/api/v1/cloud/kms/decrypt",
      body: { keyArn: "arn:...", ciphertext: "enc" },
      token: "tok",
      fetchFn: fetch,
    });
    expect(result).toEqual({ plaintext: "abc123" });
  });

  it("throws on envelope with success: false", async () => {
    const fetch = mockFetch(200, { success: false, message: "Forbidden" });
    await expect(
      request("http://localhost", {
        method: "GET",
        path: "/test",
        token: "tok",
        fetchFn: fetch,
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("throws ClefClientError on 401", async () => {
    const fetch = mockFetch(401, {});
    await expect(
      request("http://localhost", {
        method: "GET",
        path: "/test",
        token: "tok",
        fetchFn: fetch,
      }),
    ).rejects.toThrow(ClefClientError);
  });

  it("throws ClefClientError on 503", async () => {
    const fetch = mockFetch(503, {});
    await expect(
      request("http://localhost", {
        method: "GET",
        path: "/test",
        token: "tok",
        fetchFn: fetch,
      }),
    ).rejects.toThrow("Secrets expired");
  });

  it("retries once on network error", async () => {
    const fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ key: "val" }),
      });

    const result = await request<Record<string, string>>("http://localhost", {
      method: "GET",
      path: "/test",
      token: "tok",
      fetchFn: fetch,
    });
    expect(result).toEqual({ key: "val" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws after two network failures", async () => {
    const fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      request("http://localhost", {
        method: "GET",
        path: "/test",
        token: "tok",
        fetchFn: fetch,
      }),
    ).rejects.toThrow("Connection failed");
  });

  it("retries once on 5xx", async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: "ISE" } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);

    const result = await request("http://localhost", {
      method: "GET",
      path: "/test",
      token: "tok",
      fetchFn: fetch,
    });
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends authorization header", async () => {
    const fetch = mockFetch(200, {});
    await request("http://localhost", {
      method: "GET",
      path: "/test",
      token: "my-secret-token",
      fetchFn: fetch,
    });
    const headers = fetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer my-secret-token");
  });

  it("sends JSON body for POST", async () => {
    const fetch = mockFetch(200, { data: {}, success: true, message: "ok" });
    await request("http://localhost", {
      method: "POST",
      path: "/test",
      body: { foo: "bar" },
      token: "tok",
      fetchFn: fetch,
    });
    expect(fetch.mock.calls[0][1].body).toBe('{"foo":"bar"}');
    expect(fetch.mock.calls[0][1].headers["Content-Type"]).toBe("application/json");
  });
});
