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
      moduleNameMapper: {
        // Resolve @clef-sh/core to source rather than the built dist. The
        // dist is a single esbuild bundle that inlines write-file-atomic, so
        // jest.mock("write-file-atomic") cannot intercept it. Pointing at
        // the source lets the write-file-atomic module mapping below
        // intercept SopsClient.encrypt's atomic write.
        "^@clef-sh/core$": "<rootDir>/../core/src/index.ts",
        "^@clef-sh/runtime$": "<rootDir>/../runtime/src/index.ts",
        "^age-encryption$": "<rootDir>/../core/src/__mocks__/age-encryption.ts",
        "^write-file-atomic$": "<rootDir>/../core/src/__mocks__/write-file-atomic.ts",
      },
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
