export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-line-length": [0, "always"],
    "body-max-line-length": [0, "always"],
    "footer-max-line-length": [0, "always"],
  },
  ignores: [
    (commit) =>
      commit.includes("has signed the CLA") ||
      commit.includes("Creating file for storing CLA Signatures"),
  ],
};
