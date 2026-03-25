import type { BrokerHandler } from "@clef-sh/broker";

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

export const handler: BrokerHandler = {
  create: async (config) => {
    const params: Record<string, string> = {
      grant_type: "client_credentials",
      client_id: config.CLIENT_ID,
      client_secret: config.CLIENT_SECRET,
    };
    if (config.SCOPE) params.scope = config.SCOPE;
    if (config.AUDIENCE) params.audience = config.AUDIENCE;

    const res = await fetch(config.TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Token request failed (${res.status}): ${body}`);
    }

    const token = (await res.json()) as TokenResponse;

    if (!token.access_token) {
      throw new Error("Token response missing access_token");
    }

    return {
      data: { ACCESS_TOKEN: token.access_token },
      ttl: token.expires_in ?? 3600,
    };
  },
};
