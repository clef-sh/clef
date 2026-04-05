module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [0, "always"],
    "footer-max-line-length": [0, "always"],
  },
  ignores: [
    (commit) =>
      commit.includes("has signed the CLA") ||
      commit.includes("Creating file for storing CLA Signatures"),
  ],
};
