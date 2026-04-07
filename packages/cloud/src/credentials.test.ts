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

  it("should read valid credentials with refreshToken", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      "refreshToken: rt_abc123\ncognitoDomain: https://auth.example.com\nclientId: cli_123\nendpoint: https://custom.api\n",
    );

    const result = readCloudCredentials();

    expect(result).toMatchObject({
      refreshToken: "rt_abc123",
      cognitoDomain: "https://auth.example.com",
      clientId: "cli_123",
      endpoint: "https://custom.api",
    });
  });

  it("should return null when only legacy token is present", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("token: clef_tok_abc123\n");

    expect(readCloudCredentials()).toBeNull();
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
    writeCloudCredentials({ refreshToken: "cognito_refresh_abc123" });

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "/home/test/.clef/credentials.yaml",
      expect.stringContaining("cognito_refresh_abc123"),
      { mode: 0o600 },
    );
  });

  it("should include endpoint when specified", () => {
    writeCloudCredentials({ refreshToken: "tok", endpoint: "https://custom.api" });

    const written = mockFs.writeFileSync.mock.calls[0][1] as string;
    expect(written).toContain("custom.api");
  });

  it("should create ~/.clef/ directory if it does not exist", () => {
    mockFs.existsSync.mockReturnValue(false);

    writeCloudCredentials({ refreshToken: "tok" });

    expect(mockFs.mkdirSync).toHaveBeenCalledWith("/home/test/.clef", {
      recursive: true,
      mode: 0o700,
    });
  });
});
