/**
 * Unified-diff rendering for dry-run / preview flows.
 *
 * Wraps jsdiff's `createPatch` with the project's plain-mode handling and
 * ANSI colorization.  Designed to be shape-agnostic — any caller that can
 * produce (relPath, before, after) text can use it.  Consumers today:
 * `policy init --dry-run`.  Expected future consumers: broker-registry
 * updates, manifest schema bumps, template-regen commands.
 */
import { createPatch } from "diff";
import pc from "picocolors";
import { isPlainMode } from "./output/symbols";

export interface DiffRenderOptions {
  /** Override the "before" label in the patch header.  Default: "current". */
  beforeLabel?: string;
  /** Override the "after" label in the patch header.  Default: "new". */
  afterLabel?: string;
  /** Lines of unchanged context around each hunk.  Default: 3. */
  context?: number;
}

/**
 * Render a unified diff between `before` and `after`.  Returns an empty
 * string when the two are byte-identical.  In plain mode (CI / --plain),
 * colorization is suppressed.
 */
export function renderUnifiedDiff(
  relPath: string,
  before: string,
  after: string,
  options: DiffRenderOptions = {},
): string {
  if (before === after) return "";
  const patch = createPatch(
    relPath,
    before,
    after,
    options.beforeLabel ?? "current",
    options.afterLabel ?? "new",
    { context: options.context ?? 3 },
  );
  return isPlainMode() ? patch : colorize(patch);
}

function colorize(patch: string): string {
  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return pc.bold(line);
      if (line.startsWith("@@")) return pc.cyan(line);
      if (line.startsWith("+")) return pc.green(line);
      if (line.startsWith("-")) return pc.red(line);
      return line;
    })
    .join("\n");
}
