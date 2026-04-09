import { SopsMissingError, SopsVersionError } from "@clef-sh/core";
import { formatter, isJsonMode } from "./output/formatter";

/** Emit a JSON error envelope and exit. */
export function exitJsonError(message: string): never {
  formatter.json({ error: true, message });
  process.exit(1);
}

/**
 * Standard error handler for CLI commands. Formats dependency errors
 * (missing/outdated sops) specially, then exits with code 1.
 *
 * Commands with custom error handling (merge-driver, scan, etc.)
 * should NOT use this — handle their errors inline.
 */
export function handleCommandError(err: unknown): never {
  if (isJsonMode()) {
    exitJsonError((err as Error).message);
  }

  if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
    formatter.formatDependencyError(err);
  } else {
    formatter.error((err as Error).message);
  }
  process.exit(1);
}
