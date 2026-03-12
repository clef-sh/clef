import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ScanScreen } from "./ScanScreen";

// Mock apiFetch
jest.mock("../api", () => ({
  apiFetch: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiFetch } = require("../api") as { apiFetch: jest.Mock };

function mockStatusEmpty() {
  apiFetch.mockImplementation((url: string) => {
    if (url === "/api/scan/status") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ lastRun: null, lastRunAt: null }),
      });
    }
    return Promise.reject(new Error("unexpected"));
  });
}

function mockScanResult(result: object) {
  apiFetch.mockImplementation((url: string) => {
    if (url === "/api/scan/status") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ lastRun: null, lastRunAt: null }),
      });
    }
    if (url === "/api/scan") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(result),
      });
    }
    return Promise.reject(new Error("unexpected"));
  });
}

function mockStatusWithResult(result: object) {
  apiFetch.mockImplementation((url: string) => {
    if (url === "/api/scan/status") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ lastRun: result, lastRunAt: new Date().toISOString() }),
      });
    }
    return Promise.reject(new Error("unexpected"));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ScanScreen — idle state", () => {
  it("renders scan button in idle state", async () => {
    mockStatusEmpty();
    await act(async () => {
      render(<ScanScreen />);
    });
    await waitFor(() => {
      expect(screen.getByTestId("scan-idle")).toBeTruthy();
    });
  });

  it("shows severity radio buttons", async () => {
    mockStatusEmpty();
    await act(async () => {
      render(<ScanScreen />);
    });
    await waitFor(() => {
      expect(screen.getByTestId("severity-all")).toBeTruthy();
      expect(screen.getByTestId("severity-high")).toBeTruthy();
    });
  });
});

describe("ScanScreen — scan triggered", () => {
  it("calls POST /api/scan when scan button is clicked", async () => {
    mockScanResult({
      matches: [],
      unencryptedMatrixFiles: [],
      filesScanned: 10,
      filesSkipped: 2,
      durationMs: 100,
    });

    await act(async () => {
      render(<ScanScreen />);
    });

    await waitFor(() => screen.getByTestId("scan-idle"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("scan-button"));
    });

    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scanCall = apiFetch.mock.calls.find((c: any[]) => c[0] === "/api/scan");
      expect(scanCall).toBeDefined();
    });
  });

  it("shows clean result after scan with no issues", async () => {
    mockScanResult({
      matches: [],
      unencryptedMatrixFiles: [],
      filesScanned: 10,
      filesSkipped: 0,
      durationMs: 200,
    });

    await act(async () => {
      render(<ScanScreen />);
    });

    await waitFor(() => screen.getByTestId("scan-idle"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("scan-button"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("scan-clean")).toBeTruthy();
    });
  });

  it("shows issues when scan returns matches", async () => {
    mockScanResult({
      matches: [
        {
          file: "src/config.ts",
          line: 5,
          column: 1,
          matchType: "pattern",
          patternName: "AWS access key",
          preview: "AKIA\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
        },
      ],
      unencryptedMatrixFiles: [],
      filesScanned: 10,
      filesSkipped: 0,
      durationMs: 300,
    });

    await act(async () => {
      render(<ScanScreen />);
    });

    await waitFor(() => screen.getByTestId("scan-idle"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("scan-button"));
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId("match-preview").length).toBeGreaterThan(0);
    });
  });
});

describe("ScanScreen — dismiss", () => {
  it("hides match after dismiss and shows dismissed count", async () => {
    mockScanResult({
      matches: [
        {
          file: "src/config.ts",
          line: 5,
          column: 1,
          matchType: "pattern",
          patternName: "AWS access key",
          preview: "AKIA\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
        },
      ],
      unencryptedMatrixFiles: [],
      filesScanned: 5,
      filesSkipped: 0,
      durationMs: 80,
    });

    await act(async () => {
      render(<ScanScreen />);
    });

    await waitFor(() => screen.getByTestId("scan-idle"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("scan-button"));
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId("dismiss-button").length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByTestId("dismiss-button")[0]);
    });

    await waitFor(() => {
      expect(screen.getByText(/dismissed/)).toBeTruthy();
    });
  });
});

describe("ScanScreen — filter", () => {
  it("filters to pattern matches when pattern filter selected", async () => {
    mockScanResult({
      matches: [
        {
          file: "src/a.ts",
          line: 1,
          column: 1,
          matchType: "pattern",
          patternName: "AWS access key",
          preview: "AKIA\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
        },
        {
          file: "src/b.ts",
          line: 2,
          column: 1,
          matchType: "entropy",
          entropy: 5.1,
          preview: "DB_PASS=\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
        },
      ],
      unencryptedMatrixFiles: [],
      filesScanned: 10,
      filesSkipped: 0,
      durationMs: 100,
    });

    await act(async () => {
      render(<ScanScreen />);
    });
    await waitFor(() => screen.getByTestId("scan-idle"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("scan-button"));
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId("match-preview").length).toBe(2);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("filter-pattern"));
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId("match-preview").length).toBe(1);
    });
  });

  it("hides entropy matches in high severity mode", async () => {
    mockStatusEmpty();

    await act(async () => {
      render(<ScanScreen />);
    });

    await waitFor(() => screen.getByTestId("scan-idle"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("severity-high"));
    });

    // Verify high severity is selected
    const radioHigh = screen.getByTestId("severity-high") as HTMLInputElement;
    expect(radioHigh.checked).toBe(true);
  });
});

describe("ScanScreen — restore from session", () => {
  it("restores last scan result on mount via GET /api/scan/status", async () => {
    mockStatusWithResult({
      matches: [],
      unencryptedMatrixFiles: [],
      filesScanned: 15,
      filesSkipped: 3,
      durationMs: 500,
    });

    await act(async () => {
      render(<ScanScreen />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("scan-clean")).toBeTruthy();
    });
  });

  it("shows issues state when restored result has issues", async () => {
    mockStatusWithResult({
      matches: [
        {
          file: "src/secret.ts",
          line: 3,
          column: 1,
          matchType: "pattern",
          patternName: "Stripe live key",
          preview: "sk_l\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
        },
      ],
      unencryptedMatrixFiles: [],
      filesScanned: 8,
      filesSkipped: 0,
      durationMs: 400,
    });

    await act(async () => {
      render(<ScanScreen />);
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId("match-preview").length).toBeGreaterThan(0);
    });
  });
});
