// Session token — extracted from URL query parameter on initial page load,
// stored in memory only (never localStorage).
let sessionToken: string | null = null;

export function initToken(): void {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    sessionToken = token;
    // Remove token from URL to avoid leaking it in browser history
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.pathname + url.hash);
  }
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (sessionToken) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  return fetch(path, { ...init, headers });
}
