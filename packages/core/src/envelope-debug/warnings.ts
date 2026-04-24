/**
 * Canonical `--reveal` warning strings for the envelope debug surface.
 *
 * Emitted by the CLI to stderr (before the first stdout byte of a revealed
 * value, only after validation passes), and by the UI as a banner above the
 * Decrypt card. Two variants:
 *
 *   - REVEAL_WARNING (all-values)      — used with --reveal (unscoped)
 *   - formatRevealWarning("DB_URL")    — named-key variant, used with --key
 *
 * The named-key variant exists because `--key <name>` reduces the
 * disclosure surface to a single value; the warning should say which
 * value is about to appear so the operator can make an informed call
 * (a shoulder-surfer sees one secret, not the whole payload).
 */

const WARNING_TAIL =
  "Shell history, terminal scrollback, and any attached logging " +
  "(tmux capture-pane, CI log collectors, screen-recording) may retain " +
  "it. Proceed only if this terminal and its upstream captures are trusted.";

export const REVEAL_WARNING = `WARNING: plaintext will be printed to stdout. ${WARNING_TAIL}`;

/**
 * Build the `--reveal` warning. Without `key`, returns the canonical
 * all-values `REVEAL_WARNING`. With a key name, returns a variant that
 * names exactly which value is about to appear.
 */
export function formatRevealWarning(key?: string): string {
  if (!key) return REVEAL_WARNING;
  return `WARNING: value for key "${key}" will be printed to stdout. ${WARNING_TAIL}`;
}
