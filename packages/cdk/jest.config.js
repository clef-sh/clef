/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  collectCoverageFrom: [
    "<rootDir>/src/**/*.ts",
    "!<rootDir>/src/**/*.test.ts",
    "!<rootDir>/src/index.ts",
    // pack-helper and pack-invoker are thin subprocess shims covered by
    // integration tests (not yet wired); unit-testing execFileSync isn't
    // useful because the whole file IS the call.
    "!<rootDir>/src/pack-helper.ts",
    "!<rootDir>/src/pack-invoker.ts",
    // unwrap-lambda runs inside AWS Lambda at deploy time with real KMS +
    // Secrets Manager clients. Unit-testing it would require mocking AWS
    // SDK v3's middleware stack, which is heavier than the value delivers —
    // defer to end-to-end tests against a real AWS account.
    "!<rootDir>/src/unwrap-lambda/**/*.ts",
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
  },
};
