import * as http from "http";
import { BrokerHandler, ServeOptions, BrokerServerHandle } from "./types";
import { createHandler } from "./handler";
import { resolveConfig } from "./config";

/**
 * Decide whether a bind host is a strict loopback address.
 *
 * Only `127.0.0.0/8` and `::1` count. `"localhost"` and the unspecified
 * addresses (`0.0.0.0`, `::`) do NOT count — `localhost` may resolve to a
 * dual-stack address, and the unspecified addresses listen on every
 * interface (which is the exact thing we want to warn about).
 */
function isLoopbackHost(host: string): boolean {
  if (host === "::1") return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  return false;
}

/**
 * URL-safe host formatting — IPv6 literals must be bracketed.
 */
function formatHostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

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
        const url = `http://${formatHostForUrl(host)}:${boundPort}`;
        onLog("info", `Broker serving at ${url}`, { host, port: boundPort });
        if (!isLoopbackHost(host)) {
          onLog(
            "warn",
            `Broker bound to non-loopback host "${host}" — the credential-issuing ` +
              `endpoint is reachable from every interface this address resolves to. ` +
              `Set CLEF_BROKER_HOST=127.0.0.1 (or restrict network access at the ` +
              `container/firewall level) unless this exposure is intentional.`,
            { host, port: boundPort },
          );
        }
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
