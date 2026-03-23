import { CloudCIContext } from "../types";

/**
 * Detects the current CI provider from environment variables and returns
 * a {@link CloudCIContext} with provider, pipeline URL, and trigger info.
 *
 * Returns `undefined` when not running in a CI environment.
 */
export function collectCIContext(): CloudCIContext | undefined {
  const env = process.env;

  if (env.GITHUB_ACTIONS) {
    const serverUrl = env.GITHUB_SERVER_URL ?? "https://github.com";
    const repo = env.GITHUB_REPOSITORY ?? "";
    const runId = env.GITHUB_RUN_ID ?? "";
    const pipelineUrl = repo && runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : undefined;
    return {
      provider: "github-actions",
      pipelineUrl,
      trigger: env.GITHUB_EVENT_NAME,
    };
  }

  if (env.GITLAB_CI) {
    return {
      provider: "gitlab-ci",
      pipelineUrl: env.CI_PIPELINE_URL,
      trigger: env.CI_PIPELINE_SOURCE,
    };
  }

  if (env.CIRCLECI) {
    return {
      provider: "circleci",
      pipelineUrl: env.CIRCLE_BUILD_URL,
    };
  }

  if (env.CI) {
    return {
      provider: "unknown",
    };
  }

  return undefined;
}
