declare module "@clef-sh/ui" {
  import { SubprocessRunner } from "@clef-sh/core";

  export interface ServerHandle {
    url: string;
    token: string;
    stop: () => Promise<void>;
    address: () => { address: string; port: number };
  }

  export function startServer(
    port: number,
    repoRoot: string,
    runner?: SubprocessRunner,
  ): Promise<ServerHandle>;
}
