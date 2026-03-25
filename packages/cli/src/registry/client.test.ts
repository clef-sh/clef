import { fetchIndex, fetchBrokerFile, findBroker, RegistryIndex } from "./client";

const mockIndex: RegistryIndex = {
  version: 1,
  generatedAt: "2026-03-24T00:00:00.000Z",
  brokers: [
    {
      name: "rds-iam",
      version: "1.0.0",
      description: "Generate RDS IAM tokens",
      author: "clef-sh",
      provider: "aws",
      tier: 1,
      path: "aws/rds-iam",
      outputKeys: ["DB_TOKEN"],
    },
    {
      name: "sql-database",
      version: "1.0.0",
      description: "Dynamic SQL credentials",
      author: "clef-sh",
      provider: "agnostic",
      tier: 2,
      path: "agnostic/sql-database",
      outputKeys: ["DB_USER", "DB_PASSWORD"],
    },
  ],
};

const mockFetch = jest.fn() as jest.MockedFunction<typeof global.fetch>;
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("fetchIndex", () => {
  it("fetches and parses the registry index", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockIndex,
    } as Response);

    const index = await fetchIndex("https://example.com/brokers");
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/brokers/index.json");
    expect(index.brokers).toHaveLength(2);
    expect(index.brokers[0].name).toBe("rds-iam");
  });

  it("throws on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    await expect(fetchIndex("https://example.com/brokers")).rejects.toThrow("404");
  });
});

describe("fetchBrokerFile", () => {
  it("fetches a file from the broker path", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "file content",
    } as Response);

    const content = await fetchBrokerFile(
      "https://example.com/brokers",
      "aws/rds-iam",
      "handler.ts",
    );
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/brokers/aws/rds-iam/handler.ts");
    expect(content).toBe("file content");
  });

  it("throws on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    await expect(
      fetchBrokerFile("https://example.com/brokers", "aws/rds-iam", "handler.ts"),
    ).rejects.toThrow("404");
  });
});

describe("findBroker", () => {
  it("finds a broker by name", () => {
    const broker = findBroker(mockIndex, "rds-iam");
    expect(broker).toBeDefined();
    expect(broker!.name).toBe("rds-iam");
  });

  it("returns undefined for unknown broker", () => {
    expect(findBroker(mockIndex, "nonexistent")).toBeUndefined();
  });
});
