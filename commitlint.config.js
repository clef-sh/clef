module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Dependabot commit bodies contain long URLs and changelogs
    "body-max-line-length": [0, "always"],
    "footer-max-line-length": [0, "always"],
  },
};
