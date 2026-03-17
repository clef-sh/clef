// Session token — extracted from URL query parameter on initial page load.
// Persisted in sessionStorage so it survives same-tab refreshes but is
// cleared when the tab closes (never written to localStorage).
const SESSION_KEY = "clef_ui_token";

let sessionToken: string | null = null;

export function initToken(): void {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    sessionToken = token;
    sessionStorage.setItem(SESSION_KEY, token);
    // Remove token from URL to avoid leaking it in browser history
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.pathname + url.hash);
  } else {
    // Restore from sessionStorage on refresh (token no longer in URL)
    sessionToken = sessionStorage.getItem(SESSION_KEY);
  }
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (sessionToken) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  return fetch(path, { ...init, headers });
}
