# @clef-sh/client

Lightweight SDK for consuming [Clef](https://clef.sh) secrets at runtime. Zero dependencies.

## Install

```bash
npm install @clef-sh/client
```

## App SDK

Read secrets from a `clef serve` endpoint (or Clef Cloud). Falls back to environment variables.

```typescript
import { ClefClient } from "@clef-sh/client";

const secrets = new ClefClient();

const dbUrl = await secrets.get("DB_URL");
const all = await secrets.getAll();
const keyNames = await secrets.keys();
const isUp = await secrets.health();
```

### Configuration

| Option        | Env var            | Default                 | Description                                   |
| ------------- | ------------------ | ----------------------- | --------------------------------------------- |
| `endpoint`    | `CLEF_ENDPOINT`    | `http://127.0.0.1:7779` | Serve endpoint URL                            |
| `token`       | `CLEF_AGENT_TOKEN` | —                       | Bearer token for authentication               |
| `envFallback` | —                  | `true`                  | Fall back to `process.env` when key not found |
| `cacheTtlMs`  | —                  | `0`                     | In-memory cache TTL (0 = no caching)          |

## Cloud KMS Provider

For `@clef-sh/runtime` integration — decrypts artifacts encrypted with Clef Cloud's managed KMS.

```typescript
import { CloudKmsProvider } from "@clef-sh/client/kms";

const kms = new CloudKmsProvider({
  endpoint: "https://api.clef.sh",
  token: process.env.CLEF_AGENT_TOKEN,
});
```

The runtime uses this automatically when a packed artifact specifies the `cloud` KMS provider.

## Documentation

- [Runtime Agent guide](https://docs.clef.sh/guide/agent)
- [Clef Cloud guide](https://docs.clef.sh/guide/cloud)
- [API reference](https://docs.clef.sh/api/)

## License

MIT
