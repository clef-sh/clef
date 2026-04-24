/**
 * Canonical `--reveal` warning string for `clef envelope decrypt`.
 *
 * Exported as a constant so tests can pin the literal text and the UI can
 * import the same string when parity is added in a later PR.
 *
 * Always flushed to stderr, before the first stdout byte of a revealed
 * value, and only AFTER all validation (hash / expiry / key / decrypt)
 * has passed. This prevents the UX where a user sees "plaintext will be
 * printed" followed by an error with no output.
 */
export const REVEAL_WARNING =
  "WARNING: plaintext will be printed to stdout. Shell history, terminal " +
  "scrollback, and any attached logging (tmux capture-pane, CI log " +
  "collectors, screen-recording) may retain it. Proceed only if this " +
  "terminal and its upstream captures are trusted.";
