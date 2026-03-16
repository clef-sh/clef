/**
 * Global Jest setup for CLI tests.
 *
 * Mocks the core sops resolver so that SopsClient always uses bare "sops" as
 * the command — preventing the bundled platform package from being resolved
 * via require.resolve in the test environment.
 */
jest.mock("../core/src/sops/resolver", () => ({
  resolveSopsPath: jest.fn().mockReturnValue({ path: "sops", source: "system" }),
  resetSopsResolution: jest.fn(),
}));
