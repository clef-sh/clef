import { initialFetch, INITIAL_FETCH_RETRIES } from "./initial-fetch";
import type { ArtifactPoller, SecretsCache } from "@clef-sh/runtime";

jest.useFakeTimers();

const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

function makePoller(
  fetchAndDecrypt: jest.Mock = jest.fn().mockResolvedValue(undefined),
): ArtifactPoller {
  return { fetchAndDecrypt, fetchAndValidate: jest.fn() } as unknown as ArtifactPoller;
}

function makeCache(): SecretsCache {
  return { swap: jest.fn() } as unknown as SecretsCache;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("initialFetch", () => {
  it("succeeds on first attempt without retrying", async () => {
    const fetchAndDecrypt = jest.fn().mockResolvedValue(undefined);
    const poller = makePoller(fetchAndDecrypt);

    await initialFetch(poller, false, undefined, makeCache(), "HTTP https://example.com/a.json");

    expect(fetchAndDecrypt).toHaveBeenCalledTimes(1);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("retries on failure and succeeds on second attempt", async () => {
    const fetchAndDecrypt = jest
      .fn()
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValueOnce(undefined);
    const poller = makePoller(fetchAndDecrypt);

    const promise = initialFetch(
      poller,
      false,
      undefined,
      makeCache(),
      "HTTP https://example.com/a.json",
    );

    // First attempt fails, logs retry, schedules delay
    await Promise.resolve();
    jest.advanceTimersByTime(2_000);
    await promise;

    expect(fetchAndDecrypt).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("attempt 1/3"));
  });

  it("throws with 403 hint after exhausting retries", async () => {
    const fetchAndDecrypt = jest
      .fn()
      .mockRejectedValue(new Error("Failed to fetch artifact from HTTP s3: 403 Forbidden"));
    const poller = makePoller(fetchAndDecrypt);

    const promise = initialFetch(
      poller,
      false,
      undefined,
      makeCache(),
      "HTTP https://bucket.s3.amazonaws.com/a.json",
    );

    // Advance through all retry delays
    for (let i = 0; i < INITIAL_FETCH_RETRIES; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(10_000);
    }

    await expect(promise).rejects.toThrow("IAM role or credentials");
    await expect(promise).rejects.toThrow("3 attempts");
    expect(fetchAndDecrypt).toHaveBeenCalledTimes(INITIAL_FETCH_RETRIES);
  });

  it("throws with 404 hint after exhausting retries", async () => {
    const fetchAndDecrypt = jest
      .fn()
      .mockRejectedValue(new Error("Failed to fetch artifact from HTTP s3: 404 Not Found"));
    const poller = makePoller(fetchAndDecrypt);

    const promise = initialFetch(
      poller,
      false,
      undefined,
      makeCache(),
      "HTTP https://bucket.s3.amazonaws.com/a.json",
    );

    for (let i = 0; i < INITIAL_FETCH_RETRIES; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(10_000);
    }

    await expect(promise).rejects.toThrow("does not exist yet");
    await expect(promise).rejects.toThrow("clef pack");
  });

  it("throws with NoSuchKey hint for S3 XML errors", async () => {
    const fetchAndDecrypt = jest
      .fn()
      .mockRejectedValue(new Error("NoSuchKey: The specified key does not exist"));
    const poller = makePoller(fetchAndDecrypt);

    const promise = initialFetch(
      poller,
      false,
      undefined,
      makeCache(),
      "HTTP https://bucket.s3.amazonaws.com/a.json",
    );

    for (let i = 0; i < INITIAL_FETCH_RETRIES; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(10_000);
    }

    await expect(promise).rejects.toThrow("does not exist yet");
  });

  it("throws with generic hint for non-HTTP errors", async () => {
    const fetchAndDecrypt = jest
      .fn()
      .mockRejectedValue(new Error("getaddrinfo ENOTFOUND example.com"));
    const poller = makePoller(fetchAndDecrypt);

    const promise = initialFetch(
      poller,
      false,
      undefined,
      makeCache(),
      "HTTP https://example.com/a.json",
    );

    for (let i = 0; i < INITIAL_FETCH_RETRIES; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(10_000);
    }

    await expect(promise).rejects.toThrow("URL and network connectivity");
  });

  it("logs each retry attempt with attempt number", async () => {
    const fetchAndDecrypt = jest.fn().mockRejectedValue(new Error("connection refused"));
    const poller = makePoller(fetchAndDecrypt);

    const promise = initialFetch(
      poller,
      false,
      undefined,
      makeCache(),
      "HTTP https://example.com/a.json",
    );

    for (let i = 0; i < INITIAL_FETCH_RETRIES; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(10_000);
    }

    await expect(promise).rejects.toThrow();

    // Should log for attempts 1 and 2, not for the final attempt
    expect(consoleSpy).toHaveBeenCalledTimes(INITIAL_FETCH_RETRIES - 1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("attempt 1/3"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("attempt 2/3"));
  });
});
