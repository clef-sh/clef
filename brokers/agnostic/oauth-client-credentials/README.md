# oauth-client-credentials

## Description

Refresh OAuth2 access tokens using the client credentials grant. Works with any OAuth2-compliant provider — Stripe, Twilio, Auth0, Okta, Salesforce, GitHub, Slack, Datadog, and hundreds more. One broker for every SaaS API that supports OAuth2.

## Prerequisites

- An OAuth2 client ID and client secret from your provider
- The provider's token endpoint URL
- Network access from the broker to the token endpoint

## Configuration

| Input           | Required | Secret | Default | Description                             |
| --------------- | -------- | ------ | ------- | --------------------------------------- |
| `TOKEN_URL`     | Yes      | No     | —       | OAuth2 token endpoint URL               |
| `CLIENT_ID`     | Yes      | Yes    | —       | OAuth2 client ID                        |
| `CLIENT_SECRET` | Yes      | Yes    | —       | OAuth2 client secret                    |
| `SCOPE`         | No       | No     | —       | OAuth2 scope (space-separated)          |
| `AUDIENCE`      | No       | No     | —       | OAuth2 audience (Auth0, some providers) |

## Deploy

```bash
clef install oauth-client-credentials

# Store root credentials in a Clef namespace
clef set broker-oauth/production CLIENT_ID "your-client-id"
clef set broker-oauth/production CLIENT_SECRET "your-client-secret"

# Set non-secret config as env vars
export CLEF_BROKER_HANDLER_TOKEN_URL="https://auth.example.com/oauth/token"
export CLEF_BROKER_HANDLER_SCOPE="read:data write:data"

# Deploy as Lambda (see shared deployment templates)
```

## How It Works

1. The broker sends a `POST` to the token endpoint with `grant_type=client_credentials`
2. The provider returns a short-lived access token (typically 1 hour)
3. The broker packs the token into a Clef artifact envelope with KMS envelope encryption
4. The agent polls the broker, unwraps via KMS, and serves `ACCESS_TOKEN` to your app
5. The token expires naturally — the agent fetches a fresh one before expiry

## Provider Examples

**Auth0:**

```
TOKEN_URL=https://your-tenant.auth0.com/oauth/token
AUDIENCE=https://api.example.com
```

**Stripe:** Stripe uses API keys directly, not OAuth2. Use `clef set` for static Stripe keys instead.

**Salesforce:**

```
TOKEN_URL=https://login.salesforce.com/services/oauth2/token
```

**GitHub App:**

```
TOKEN_URL=https://api.github.com/app/installations/{id}/access_tokens
```

Note: GitHub App tokens use a different flow (JWT). Consider the `github-app-token` broker instead.
