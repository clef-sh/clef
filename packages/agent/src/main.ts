/* eslint-disable no-console -- standalone daemon entry point, console is the output mechanism */
/**
 * Standalone entry point for the Clef agent SEA binary.
 *
 * Reads configuration from environment variables, assembles the poller,
 * cache, server, and daemon, then starts the daemon lifecycle.
 */
import { resolveConfig, ConfigError } from "./config";
import {
  SecretsCache,
  AgeDecryptor,
  ArtifactPoller,
  createVcsProvider,
  VcsArtifactSource,
  HttpArtifactSource,
  FileArtifactSource,
  DiskCache,
} from "@clef-sh/runtime";
import type { ArtifactSource } from "@clef-sh/runtime";
import { startAgentServer } from "./server";
import { Daemon } from "./lifecycle/daemon";

async function main(): Promise<void> {
  const config = resolveConfig();

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
    source =
      config.source.startsWith("http://") || config.source.startsWith("https://")
        ? new HttpArtifactSource(config.source)
        : new FileArtifactSource(config.source);
  } else {
    throw new ConfigError("No artifact source configured.");
  }

  const diskCache =
    config.cachePath && config.vcs
      ? new DiskCache(config.cachePath, config.vcs.identity, config.vcs.environment)
      : undefined;

  const cache = new SecretsCache();
  const poller = new ArtifactPoller({
    source,
    privateKey,
    cache,
    diskCache,
    cacheTtl: config.cacheTtl,
    onError: (err) => console.error(`[clef-agent] poll error: ${err.message}`),
  });

  await poller.fetchAndDecrypt();

  const server = await startAgentServer({
    port: config.port,
    token: config.token,
    cache,
    cacheTtl: config.cacheTtl,
  });

  const daemon = new Daemon({
    poller,
    server,
    onLog: (msg) => console.log(`[clef-agent] ${msg}`),
  });

  console.log(`[clef-agent] token: ${config.token.slice(0, 8)}...`);
  await daemon.start();
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`[clef-agent] config error: ${err.message}`);
  } else {
    console.error(`[clef-agent] fatal: ${err.message}`);
  }
  process.exit(1);
});
