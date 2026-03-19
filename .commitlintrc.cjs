module.exports = {
  extends: ["@commitlint/config-conventional"],
  ignores: [
    (commit) =>
      commit.includes("has signed the CLA") ||
      commit.includes("Creating file for storing CLA Signatures"),
  ],
};
