/** Default Clef Cloud API base URL. Override with CLEF_CLOUD_ENDPOINT. */
export const CLOUD_DEFAULT_ENDPOINT = "https://cloud.clef.sh";

/** Session JWT lifetime (1 hour) in milliseconds. */
export const SESSION_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

// ── GitHub Device Flow constants ──────────────────────────────────────────
// These are used by device-flow.ts (the GitHub auth implementation).
// Future providers will have their own constants in their provider files.

/** OAuth scopes requested during the GitHub Device Flow. */
export const GITHUB_DEVICE_FLOW_SCOPES = "read:user user:email";

/** GitHub Device Flow endpoints. */
export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
