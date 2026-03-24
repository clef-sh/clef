import * as http from "http";
import { BrokerHandler, ServeOptions, BrokerServerHandle } from "./types";
import { createHandler } from "./handler";
import { resolveConfig } from "./config";

/**
 * Start a broker HTTP server that serves Clef artifact envelopes.
 *
 * This is a convenience wrapper around `createHandler()` for long-running
 * processes (containers, VMs). For serverless (Lambda, Cloud Functions),
 * use `createHandler()` directly.
 */
export async function serve(
  handler: BrokerHandler,
  options?: Partial<ServeOptions>,
): Promise<BrokerServerHandle> {
  const envConfig = resolveConfig();
  const port = options?.port ?? envConfig.port;
  const host = options?.host ?? envConfig.host;
  const onLog = options?.onLog ?? (() => {});

  const broker = createHandler(handler, options);

  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.url !== "/" && req.url !== "") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const result = await broker.invoke();
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
  });

  return new Promise<BrokerServerHandle>((resolve, reject) => {
    try {
      server.listen(port, host, () => {
        const addr = server.address();
        const boundPort = typeof addr === "object" && addr ? addr.port : port;
        const url = `http://127.0.0.1:${boundPort}`;
        onLog("info", `Broker serving at ${url}`, { port: boundPort });
        resolve({
          url,
          stop: async () => {
            await broker.shutdown();

            await new Promise<void>((resolveClose, rejectClose) => {
              server.close((err) => (err ? rejectClose(err) : resolveClose()));
              const drainTimer = setTimeout(() => {
                server.closeAllConnections();
              }, 3000);
              drainTimer.unref();
            });
          },
        });
      });

      server.on("error", (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}
