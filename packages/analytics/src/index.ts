/**
 * @clef-sh/analytics — CLI analytics for Clef.
 *
 * Powered by PostHog. Fully opt-out:
 *   - CLEF_ANALYTICS=0 (env var, session-scoped)
 *   - analytics: false in ~/.clef/config.yaml (persistent)
 *
 * Only tracks: command name, duration, success/failure, CLI version, OS/arch.
 * Never tracks: secret values, file paths, repo names, or any content.
 */
export { track, shutdown, isDisabled } from "./client";
