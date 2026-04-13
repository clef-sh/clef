/**
 * Auth provider registry.
 *
 * Maps VCS provider identifiers to their AuthProvider implementations.
 * Today only GitHub is supported. Adding a new provider means:
 * 1. Create providers/<name>.ts implementing AuthProvider
 * 2. Register it in the PROVIDERS map below
 * 3. The CLI will accept --provider <name> automatically
 */
import type { AuthProvider, VcsProvider } from "../types";
import { gitHubAuthProvider } from "./github";

const PROVIDERS: Record<string, AuthProvider> = {
  github: gitHubAuthProvider,
};

/** The default provider when none is specified. */
export const DEFAULT_PROVIDER: VcsProvider = "github";

/** All registered provider IDs. */
export const PROVIDER_IDS = Object.keys(PROVIDERS) as VcsProvider[];

/**
 * Resolve a provider by ID. Throws if the provider is not registered.
 */
export function resolveAuthProvider(id: string): AuthProvider {
  const provider = PROVIDERS[id];
  if (!provider) {
    const available = PROVIDER_IDS.join(", ");
    throw new Error(`Unknown provider "${id}". Available providers: ${available}`);
  }
  return provider;
}

export { gitHubAuthProvider } from "./github";
