import { createKmsProvider } from "@clef-sh/runtime";
import type { KmsProvider } from "@clef-sh/runtime";
import { BrokerHandler, BrokerResponse, BrokerInvoker, HandleOptions, LogFn } from "./types";
import { packEnvelope } from "./envelope";
import { resolveConfig } from "./config";

interface CachedResponse {
  body: string;
  entityId?: string;
  createdAt: number;
  ttl: number;
}

const noop: LogFn = () => {};

/**
 * Create a broker invoker with built-in caching, revocation, and shutdown.
 *
 * Returns a `BrokerInvoker` with `invoke()` and `shutdown()` methods.
 * State (cache, KMS provider, revocation tracking) lives in the closure
 * and persists across Lambda warm invocations.
 *
 * ```typescript
 * const broker = createHandler(myBroker);
 *
 * // Lambda
 * export const handler = () => broker.invoke();
 * process.on("SIGTERM", () => broker.shutdown());
 *
 * // Express
 * app.get('/', async (req, res) => {
 *   const result = await broker.invoke();
 *   res.status(result.statusCode).set(result.headers).send(result.body);
 * });
 * ```
 */
export function createHandler(
  handler: BrokerHandler,
  options?: Partial<HandleOptions>,
): BrokerInvoker {
  // Resolve config once at creation time (persists across Lambda warm invocations)
  const envConfig = resolveConfig();
  const identity = options?.identity ?? envConfig.identity;
  const environment = options?.environment ?? envConfig.environment;
  const kmsProviderName = options?.kmsProvider ?? envConfig.kmsProvider;
  const kmsKeyId = options?.kmsKeyId ?? envConfig.kmsKeyId;
  const kmsRegion = options?.kmsRegion ?? envConfig.kmsRegion;
  const handlerConfig = options?.config ?? envConfig.handlerConfig;
  const onLog = options?.onLog ?? noop;

  // Create KMS provider once, reuse across invocations
  const kms: KmsProvider = createKmsProvider(kmsProviderName, { region: kmsRegion });

  let cached: CachedResponse | undefined;
  let inflightPromise: Promise<BrokerResponse> | undefined;
  let validated = false;

  function isCacheValid(): boolean {
    if (!cached) return false;
    const elapsed = Date.now() - cached.createdAt;
    return elapsed < cached.ttl * 0.8 * 1000;
  }

  async function revokeIfNeeded(): Promise<void> {
    if (handler.revoke && cached?.entityId) {
      try {
        await handler.revoke(cached.entityId, handlerConfig);
        onLog("info", `Revoked credential: ${cached.entityId}`, {
          entityId: cached.entityId,
        });
      } catch (err) {
        onLog(
          "warn",
          `Revoke failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          {
            entityId: cached.entityId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
  }

  async function generateEnvelope(): Promise<BrokerResponse> {
    // Revoke previous credential if handler supports it (Tier 2)
    await revokeIfNeeded();

    const result = await handler.create(handlerConfig);
    const body = await packEnvelope({
      identity,
      environment,
      data: result.data,
      ttl: result.ttl,
      kmsProvider: kms,
      kmsProviderName,
      kmsKeyId,
    });

    cached = {
      body,
      entityId: result.entityId,
      createdAt: Date.now(),
      ttl: result.ttl,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body,
    };
  }

  async function invoke(): Promise<BrokerResponse> {
    try {
      // Validate connection on first invocation
      if (!validated && handler.validateConnection) {
        const ok = await handler.validateConnection(handlerConfig);
        if (!ok) {
          throw new Error("Broker handler validateConnection() returned false.");
        }
        validated = true;
      } else {
        validated = true;
      }

      // Return cached response if still valid
      if (isCacheValid()) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          body: cached!.body,
        };
      }

      // Mutex: if a generate is already in flight, wait for it
      if (inflightPromise) return await inflightPromise;

      inflightPromise = generateEnvelope().finally(() => {
        inflightPromise = undefined;
      });

      return await inflightPromise;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onLog("error", `Envelope generation failed: ${message}`, {
        error: message,
      });
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: message }),
      };
    }
  }

  async function shutdown(): Promise<void> {
    await revokeIfNeeded();
  }

  return { invoke, shutdown };
}
