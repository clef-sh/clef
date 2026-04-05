/**
 * CLI plugin entry point for @clef-sh/cloud.
 *
 * Loaded dynamically by @clef-sh/cli via `import("@clef-sh/cloud/cli")`.
 * Registers cloud-specific commands (init, login, status) on the Commander program.
 */
export { registerCloudCommands } from "./commands/cloud";
export type { CloudCliDeps } from "./commands/cloud";
