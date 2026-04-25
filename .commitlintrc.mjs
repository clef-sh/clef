export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [0, "always"],
    "body-max-line-length": [0, "always"],
    "footer-max-line-length": [0, "always"],
  },
  ignores: [
    (commit) =>
      commit.includes("has signed the CLA") ||
      commit.includes("Creating file for storing CLA Signatures") ||
      // GitHub Advanced Security / CodeQL "Copilot Autofix" bot commits do not
      // follow Conventional Commits — match the trailer it always emits so we
      // skip them without giving every contributor a free pass.
      commit.includes("Copilot Autofix powered by AI") ||
      commit.includes("github-advanced-security[bot]@users.noreply.github.com"),
  ],
};
