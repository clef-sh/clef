import * as fs from "fs";
import * as os from "os";
import { readCloudCredentials, writeCloudCredentials } from "./credentials";

jest.mock("fs");
jest.mock("os");

const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

describe("readCloudCredentials", () => {
  beforeEach(() => {
    mockOs.homedir.mockReturnValue("/home/test");
  });

  it("should return null when file does not exist", () => {
    mockFs.existsSync.mockReturnValue(false);

    expect(readCloudCredentials()).toBeNull();
  });

  it("should read valid credentials", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("token: clef_tok_abc123\nendpoint: https://custom.api\n");

    const result = readCloudCredentials();

    expect(result).toEqual({
      token: "clef_tok_abc123",
      endpoint: "https://custom.api",
    });
  });

  it("should use default endpoint when not specified", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("token: clef_tok_abc123\n");

    const result = readCloudCredentials();

    expect(result).toEqual({
      token: "clef_tok_abc123",
      endpoint: "https://api.clef.sh",
    });
  });

  it("should return null when token is missing", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("endpoint: https://api.clef.sh\n");

    expect(readCloudCredentials()).toBeNull();
  });

  it("should return null when token is empty string", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('token: ""\n');

    expect(readCloudCredentials()).toBeNull();
  });

  it("should return null when file is malformed YAML", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(":::bad yaml");

    expect(readCloudCredentials()).toBeNull();
  });
});

describe("writeCloudCredentials", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.homedir.mockReturnValue("/home/test");
    mockFs.existsSync.mockReturnValue(true);
  });

  it("should write credentials to ~/.clef/credentials.yaml", () => {
    writeCloudCredentials({ token: "clef_tok_abc123" });

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "/home/test/.clef/credentials.yaml",
      expect.stringContaining("clef_tok_abc123"),
      { mode: 0o600 },
    );
  });

  it("should include endpoint when specified", () => {
    writeCloudCredentials({ token: "tok", endpoint: "https://custom.api" });

    const written = mockFs.writeFileSync.mock.calls[0][1] as string;
    expect(written).toContain("custom.api");
  });

  it("should create ~/.clef/ directory if it does not exist", () => {
    mockFs.existsSync.mockReturnValue(false);

    writeCloudCredentials({ token: "tok" });

    expect(mockFs.mkdirSync).toHaveBeenCalledWith("/home/test/.clef", {
      recursive: true,
      mode: 0o700,
    });
  });
});
