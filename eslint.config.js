// @ts-nocheck
const js = require("@eslint/js");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");

const tsConfigs = tsPlugin.configs["flat/recommended"];

module.exports = [
  {
    // Global ignores — node_modules is ignored by default in ESLint 9
    ignores: ["**/dist/**", "**/coverage/**", "www/**", "docs/.vitepress/**"],
  },
  {
    // Scope all linting to TypeScript files only, matching the original --ext .ts,.tsx behaviour
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: tsConfigs[0].plugins,
    rules: {
      // eslint:recommended base rules
      ...js.configs.recommended.rules,
      // @typescript-eslint/recommended rules + its eslint-recommended overrides
      ...tsConfigs[1].rules,
      ...tsConfigs[2].rules,
      // Project-specific rules (unchanged from .eslintrc.json)
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "warn",
    },
  },
];
