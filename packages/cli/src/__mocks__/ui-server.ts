import type { SubprocessRunner } from "@clef-sh/core";

export interface ServerHandle {
  url: string;
  token: string;
  stop: () => Promise<void>;
  address: () => { address: string; port: number };
}

export const startServer = jest.fn(
  async (
    port: number,
    _repoRoot: string,
    _runner?: SubprocessRunner,
  ): Promise<ServerHandle> => ({
    url: `http://127.0.0.1:${port}`,
    token: "a".repeat(64),
    stop: jest.fn().mockResolvedValue(undefined),
    address: () => ({ address: "127.0.0.1", port }),
  }),
);
