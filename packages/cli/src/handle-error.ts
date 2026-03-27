import { SopsMissingError, SopsVersionError } from "@clef-sh/core";
import { formatter } from "./output/formatter";

/**
 * Standard error handler for CLI commands. Formats dependency errors
 * (missing/outdated sops) specially, then exits with code 1.
 *
 * Commands with custom error handling (merge-driver, scan, etc.)
 * should NOT use this — handle their errors inline.
 */
export function handleCommandError(err: unknown): never {
  if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
    formatter.formatDependencyError(err);
  } else {
    formatter.error((err as Error).message);
  }
  process.exit(1);
}
