export type { VcsProvider, VcsProviderConfig, VcsFileResult } from "./types";
export { GitHubProvider } from "./github";
export { GitLabProvider } from "./gitlab";
export { BitbucketProvider } from "./bitbucket";

import { VcsProvider, VcsProviderConfig } from "./types";
import { GitHubProvider } from "./github";
import { GitLabProvider } from "./gitlab";
import { BitbucketProvider } from "./bitbucket";

/** Create a VCS provider from configuration. */
export function createVcsProvider(config: VcsProviderConfig): VcsProvider {
  switch (config.provider) {
    case "github":
      return new GitHubProvider(config);
    case "gitlab":
      return new GitLabProvider(config);
    case "bitbucket":
      return new BitbucketProvider(config);
    default:
      throw new Error(`Unsupported VCS provider: ${config.provider as string}`);
  }
}
