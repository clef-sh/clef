// Re-export core modules from @clef-sh/runtime
export { SecretsCache, AgeDecryptor, ArtifactPoller, ClefRuntime, init } from "@clef-sh/runtime";
export type {
  PollerOptions,
  ArtifactEnvelope,
  RuntimeConfig,
  VcsProvider,
  VcsProviderConfig,
  VcsFileResult,
  ArtifactSource,
  ArtifactFetchResult,
  TelemetryOptions,
  TelemetryEvent,
} from "@clef-sh/runtime";
export { TelemetryEmitter } from "@clef-sh/runtime";

// Agent-specific exports
export { startAgentServer } from "./server";
export type { AgentServerHandle, AgentServerOptions } from "./server";
export { resolveConfig, ConfigError } from "./config";
export type { AgentConfig, TelemetryConfig } from "./config";
export { healthHandler, readyHandler } from "./health";
export { Daemon } from "./lifecycle/daemon";
export type { DaemonOptions } from "./lifecycle/daemon";
export { LambdaExtension } from "./lifecycle/lambda-extension";
export type { LambdaExtensionOptions } from "./lifecycle/lambda-extension";
