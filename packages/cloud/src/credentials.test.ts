import * as fs from "fs";
import * as os from "os";
import {
  readCloudCredentials,
  writeCloudCredentials,
  deleteCloudCredentials,
  isSessionExpired,
} from "./credentials";

jest.mock("fs");
jest.mock("os");

const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

describe("readCloudCredentials", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.homedir.mockReturnValue("/home/test");
  });

  it("should return null when file does not exist", () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(readCloudCredentials()).toBeNull();
  });

  it("should read valid JSON credentials", () => {
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        session_token: "jwt_abc",
        login: "jamesspears",
        email: "james@clef.sh",
        expires_at: "2026-04-12T18:00:00Z",
        base_url: "https://cloud.clef.sh",
        provider: "github",
      }),
    );

    const result = readCloudCredentials();
    expect(result).toEqual({
      session_token: "jwt_abc",
      login: "jamesspears",
      email: "james@clef.sh",
      expires_at: "2026-04-12T18:00:00Z",
      base_url: "https://cloud.clef.sh",
      provider: "github",
    });
  });

  it("should default provider to github when missing", () => {
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        session_token: "jwt_abc",
        login: "jamesspears",
        email: "james@clef.sh",
        expires_at: "2026-04-12T18:00:00Z",
        base_url: "https://cloud.clef.sh",
      }),
    );

    const result = readCloudCredentials();
    expect(result!.provider).toBe("github");
  });

  it("should return null when session_token is missing", () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ login: "jamesspears" }));

    expect(readCloudCredentials()).toBeNull();
  });

  it("should return null when file is malformed JSON", () => {
    mockFs.readFileSync.mockReturnValue("not json {{{");

    expect(readCloudCredentials()).toBeNull();
  });

  it("should return null when file content is not an object", () => {
    mockFs.readFileSync.mockReturnValue('"just a string"');

    expect(readCloudCredentials()).toBeNull();
  });
});

describe("writeCloudCredentials", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.homedir.mockReturnValue("/home/test");
  });

  it("should write credentials as JSON to ~/.clef/cloud-credentials.json", () => {
    writeCloudCredentials({
      session_token: "jwt_abc",
      login: "jamesspears",
      email: "james@clef.sh",
      expires_at: "2026-04-12T18:00:00Z",
      base_url: "https://cloud.clef.sh",
      provider: "github",
    });

    expect(mockFs.mkdirSync).toHaveBeenCalledWith("/home/test/.clef", {
      recursive: true,
      mode: 0o700,
    });

    const written = mockFs.writeFileSync.mock.calls[0][1] as string;
    expect(JSON.parse(written.trim())).toEqual({
      session_token: "jwt_abc",
      login: "jamesspears",
      email: "james@clef.sh",
      expires_at: "2026-04-12T18:00:00Z",
      base_url: "https://cloud.clef.sh",
      provider: "github",
    });

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "/home/test/.clef/cloud-credentials.json",
      expect.any(String),
      { mode: 0o600 },
    );
  });
});

describe("deleteCloudCredentials", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.homedir.mockReturnValue("/home/test");
  });

  it("should delete the credentials file", () => {
    deleteCloudCredentials();

    expect(mockFs.unlinkSync).toHaveBeenCalledWith("/home/test/.clef/cloud-credentials.json");
  });

  it("should not throw when file does not exist", () => {
    mockFs.unlinkSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => deleteCloudCredentials()).not.toThrow();
  });
});

describe("isSessionExpired", () => {
  it("should return true when expires_at is in the past", () => {
    expect(
      isSessionExpired({
        session_token: "jwt",
        login: "user",
        email: "u@e.com",
        expires_at: "2020-01-01T00:00:00Z",
        base_url: "https://cloud.clef.sh",
        provider: "github",
      }),
    ).toBe(true);
  });

  it("should return false when expires_at is in the future", () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    expect(
      isSessionExpired({
        session_token: "jwt",
        login: "user",
        email: "u@e.com",
        expires_at: future,
        base_url: "https://cloud.clef.sh",
        provider: "github",
      }),
    ).toBe(false);
  });

  it("should return true when expires_at is empty", () => {
    expect(
      isSessionExpired({
        session_token: "jwt",
        login: "user",
        email: "u@e.com",
        expires_at: "",
        base_url: "https://cloud.clef.sh",
        provider: "github",
      }),
    ).toBe(true);
  });
});
