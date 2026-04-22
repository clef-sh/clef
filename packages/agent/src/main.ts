/* eslint-disable no-console -- standalone daemon entry point, console is the output mechanism */
/**
 * Standalone entry point for the Clef agent SEA binary.
 *
 * Reads configuration from environment variables, assembles the poller,
 * cache, server, and lifecycle handler, then starts the appropriate
 * lifecycle: Lambda Extension when running inside AWS Lambda, Daemon
 * otherwise.
 */
import { resolveConfig, ConfigError } from "./config";
import {
  SecretsCache,
  AgeDecryptor,
  ArtifactPoller,
  EncryptedArtifactStore,
  createVcsProvider,
  VcsArtifactSource,
  HttpArtifactSource,
  S3ArtifactSource,
  isS3Url,
  FileArtifactSource,
  DiskCache,
  TelemetryEmitter,
} from "@clef-sh/runtime";
import type { ArtifactSource } from "@clef-sh/runtime";
import { startAgentServer } from "./server";
import { Daemon } from "./lifecycle/daemon";
import { LambdaExtension } from "./lifecycle/lambda-extension";
import { initialFetch } from "./initial-fetch";

import { version as agentVersion } from "../package.json";

const isLambda = !!process.env.AWS_LAMBDA_RUNTIME_API;

async function main(): Promise<void> {
  const config = resolveConfig();
  const jitMode = config.cacheTtl === 0;

  // Age key is optional — KMS envelope artifacts don't need one
  let privateKey: string | undefined;
  try {
    const decryptor = new AgeDecryptor();
    privateKey = decryptor.resolveKey(config.ageKey, config.ageKeyFile);
  } catch {
    // OK — will work if artifact uses KMS envelope encryption
  }

  // Construct artifact source
  let source: ArtifactSource;
  if (config.vcs) {
    const provider = createVcsProvider({
      provider: config.vcs.provider,
      repo: config.vcs.repo,
      token: config.vcs.token,
      ref: config.vcs.ref,
      apiUrl: config.vcs.apiUrl,
    });
    source = new VcsArtifactSource(provider, config.vcs.identity, config.vcs.environment);
  } else if (config.source) {
    if (isS3Url(config.source)) {
      source = new S3ArtifactSource(config.source);
    } else if (config.source.startsWith("http://") || config.source.startsWith("https://")) {
      source = new HttpArtifactSource(config.source);
    } else {
      source = new FileArtifactSource(config.source);
    }
  } else {
    throw new ConfigError("No artifact source configured.");
  }

  const diskCache =
    config.cachePath && config.vcs
      ? new DiskCache(config.cachePath, config.vcs.identity, config.vcs.environment)
      : undefined;

  const cache = new SecretsCache();
  const encryptedStore = jitMode ? new EncryptedArtifactStore() : undefined;

  const poller = new ArtifactPoller({
    source,
    privateKey,
    cache,
    diskCache,
    cacheTtl: config.cacheTtl,
    verifyKey: config.verifyKey,
    encryptedStore,
    onError: (err) => console.error(`[clef-agent] poll error: ${err.message}`),
  });

  const sourceDesc = source.describe();
  console.log(`[clef-agent] source: ${sourceDesc}`);
  console.log(`[clef-agent] fetching initial artifact...`);

  await initialFetch(poller, jitMode, encryptedStore, cache, sourceDesc);

  // Telemetry setup — after first fetch so the auth token can be read from packed secrets
  let telemetry: TelemetryEmitter | undefined;

  if (config.telemetry) {
    // Resolve auth headers from packed secrets
    const headers: Record<string, string> = {};
    const headersRaw = cache.get("CLEF_TELEMETRY_HEADERS");
    const tokenRaw = cache.get("CLEF_TELEMETRY_TOKEN");
    if (headersRaw) {
      // Comma-separated key=value pairs (OTEL convention)
      for (const pair of headersRaw.split(",")) {
        const eq = pair.indexOf("=");
        if (eq > 0) headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
    } else if (tokenRaw) {
      headers["Authorization"] = `Bearer ${tokenRaw}`;
    }

    const sourceType = config.vcs ? "vcs" : config.source?.startsWith("http") ? "http" : "file";
    telemetry = new TelemetryEmitter({
      url: config.telemetry.url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      version: agentVersion,
      agentId: config.agentId,
      identity: config.vcs?.identity ?? "unknown",
      environment: config.vcs?.environment ?? "unknown",
      sourceType,
    });
    poller.setTelemetry(telemetry);
  }

  // Wipe the cache after telemetry bootstrap in JIT mode — no plaintext in memory
  if (jitMode) {
    cache.wipe();
  }

  const server = await startAgentServer({
    port: config.port,
    token: config.token,
    cache,
    cacheTtl: config.cacheTtl,
    ...(jitMode ? { decryptor: poller.getDecryptor(), encryptedStore } : {}),
  });

  const onLog = (msg: string) => console.log(`[clef-agent] ${msg}`);

  telemetry?.agentStarted({ version: agentVersion });
  const modeLabel = jitMode ? "jit" : "cached";
  console.log(`[clef-agent] mode: ${modeLabel}`);
  console.log(`[clef-agent] token: [set]`);

  if (isLambda) {
    console.log("[clef-agent] lifecycle: lambda-extension");
    const extension = new LambdaExtension({
      poller,
      server,
      refreshTtl: config.cacheTtl,
      telemetry,
      onLog,
      skipInitialFetch: true,
    });
    await extension.start();
  } else {
    console.log("[clef-agent] lifecycle: daemon");
    const daemon = new Daemon({
      poller,
      server,
      telemetry,
      onLog,
    });
    await daemon.start();
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`[clef-agent] config error: ${err.message}`);
  } else {
    console.error(`[clef-agent] fatal: ${err.message}`);
    if (err instanceof Error) {
      // undici attaches the real failure (ECONNREFUSED, ENOTFOUND, TLS, etc.)
      // on .cause. Without surfacing it, every "fetch failed" looks identical.
      if (err.cause) console.error("cause:", err.cause);
      if (err.stack) console.error(err.stack);
    }
  }
  process.exit(1);
});
