/** @type {import('jest').Config} */
module.exports = {
  coverageThreshold: {
    global: {
      lines: 80,
      // UI components have many small helpers that are deliberately untested;
      // starting threshold reflects current baseline (78%). Raise as coverage improves.
      functions: 75,
      branches: 75,
      statements: 80,
    },
  },
  projects: [
    {
      displayName: "server",
      preset: "ts-jest",
      testEnvironment: "node",
      testMatch: ["<rootDir>/src/server/**/*.test.ts"],
      collectCoverageFrom: ["<rootDir>/src/server/**/*.ts", "!<rootDir>/src/server/**/*.test.ts"],
    },
    {
      displayName: "client",
      preset: "ts-jest",
      testEnvironment: "jsdom",
      testMatch: ["<rootDir>/src/client/**/*.test.tsx"],
      collectCoverageFrom: [
        "<rootDir>/src/client/**/*.tsx",
        "<rootDir>/src/client/**/*.ts",
        "!<rootDir>/src/client/**/*.test.tsx",
        "!<rootDir>/src/client/main.tsx",
      ],
      moduleNameMapper: {
        "\\.(css|less|scss)$": "<rootDir>/src/__mocks__/styleMock.js",
      },
    },
  ],
};
