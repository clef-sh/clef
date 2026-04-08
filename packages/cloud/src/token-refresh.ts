/**
 * Cognito token refresh via the OAuth2 token endpoint.
 *
 * Uses plain HTTP — no AWS SDK dependency. The Cognito token endpoint
 * accepts refresh tokens and returns fresh access tokens.
 */

export interface TokenRefreshConfig {
  cognitoDomain: string;
  clientId: string;
  refreshToken: string;
}

export interface TokenRefreshResult {
  accessToken: string;
  idToken: string;
  expiresIn: number;
}

/**
 * Refresh a Cognito access token using a refresh token.
 *
 * Calls the Cognito OAuth2 token endpoint directly:
 *   POST https://<domain>.auth.<region>.amazoncognito.com/oauth2/token
 *
 * @returns Fresh access token, ID token, and expiry (seconds).
 * @throws If the refresh token is expired or invalid.
 */
export async function refreshAccessToken(config: TokenRefreshConfig): Promise<TokenRefreshResult> {
  const url = `${config.cognitoDomain}/oauth2/token`;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: config.refreshToken,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 400 && text.includes("invalid_grant")) {
      throw new Error(
        "Refresh token expired or revoked. Run 'clef cloud login' to re-authenticate.",
      );
    }
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    id_token: string;
    expires_in: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    expiresIn: data.expires_in,
  };
}
