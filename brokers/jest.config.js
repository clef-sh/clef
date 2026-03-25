/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/**/*.test.ts"],
  moduleNameMapper: {
    "^@clef-sh/broker$": "<rootDir>/../packages/broker/src/index.ts",
  },
};
