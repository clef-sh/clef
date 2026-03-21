import { collectCIContext } from "./ci-context";

describe("collectCIContext", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear CI vars
    delete process.env.GITHUB_ACTIONS;
    delete process.env.GITHUB_SERVER_URL;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_RUN_ID;
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITLAB_CI;
    delete process.env.CI_PIPELINE_URL;
    delete process.env.CI_PIPELINE_SOURCE;
    delete process.env.CIRCLECI;
    delete process.env.CIRCLE_BUILD_URL;
    delete process.env.CI;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns undefined when not in CI", () => {
    expect(collectCIContext()).toBeUndefined();
  });

  describe("GitHub Actions", () => {
    it("detects GitHub Actions with full env", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "org/repo";
      process.env.GITHUB_RUN_ID = "12345";
      process.env.GITHUB_EVENT_NAME = "push";

      const ctx = collectCIContext();
      expect(ctx).toEqual({
        provider: "github-actions",
        pipelineUrl: "https://github.com/org/repo/actions/runs/12345",
        trigger: "push",
      });
    });

    it("handles missing optional GitHub env vars", () => {
      process.env.GITHUB_ACTIONS = "true";

      const ctx = collectCIContext();
      expect(ctx?.provider).toBe("github-actions");
      expect(ctx?.pipelineUrl).toBeUndefined();
      expect(ctx?.trigger).toBeUndefined();
    });
  });

  describe("GitLab CI", () => {
    it("detects GitLab CI", () => {
      process.env.GITLAB_CI = "true";
      process.env.CI_PIPELINE_URL = "https://gitlab.com/org/repo/-/pipelines/42";
      process.env.CI_PIPELINE_SOURCE = "merge_request_event";

      const ctx = collectCIContext();
      expect(ctx).toEqual({
        provider: "gitlab-ci",
        pipelineUrl: "https://gitlab.com/org/repo/-/pipelines/42",
        trigger: "merge_request_event",
      });
    });
  });

  describe("CircleCI", () => {
    it("detects CircleCI", () => {
      process.env.CIRCLECI = "true";
      process.env.CIRCLE_BUILD_URL = "https://circleci.com/gh/org/repo/42";

      const ctx = collectCIContext();
      expect(ctx).toEqual({
        provider: "circleci",
        pipelineUrl: "https://circleci.com/gh/org/repo/42",
      });
    });
  });

  describe("unknown CI", () => {
    it("returns unknown provider when only CI is set", () => {
      process.env.CI = "true";

      const ctx = collectCIContext();
      expect(ctx).toEqual({ provider: "unknown" });
    });
  });

  it("GitHub Actions takes priority over generic CI", () => {
    process.env.GITHUB_ACTIONS = "true";
    process.env.CI = "true";

    const ctx = collectCIContext();
    expect(ctx?.provider).toBe("github-actions");
  });
});
