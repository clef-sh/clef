# @clef-sh/broker

Runtime harness for [Clef](https://clef.sh) dynamic credential brokers. Write a `create()` function that generates credentials — the SDK handles age encryption, KMS wrapping, envelope construction, response caching, and graceful shutdown.

## Install

```bash
npm install @clef-sh/broker
```

## Quick start

```typescript
import { createHandler } from "@clef-sh/broker";

const broker = createHandler({
  create: async (config) => ({
    data: { DB_TOKEN: await generateRdsIamToken(config.DB_ENDPOINT) },
    ttl: 900,
  }),
});

// Lambda
export const handler = () => broker.invoke();
process.on("SIGTERM", () => broker.shutdown());
```

The broker works in any JavaScript context — Lambda, Cloud Functions, Azure Functions, containers, plain Node.

## Features

- **`createHandler()`** — returns a `BrokerInvoker` with `invoke()` and `shutdown()` methods
- **`serve()`** — convenience HTTP server wrapper for containers/VMs
- **`packEnvelope()`** — standalone envelope construction for advanced use
- **`validateBroker()`** — test harness for registry contributions
- **Response caching** — caches envelopes for 80% of TTL, matching the agent's polling schedule
- **Tier 2 revocation** — automatically calls `revoke()` on rotation and shutdown
- **Structured logging** — `onLog(level, message, context)` for observability
- **KMS envelope encryption** — AWS KMS, GCP Cloud KMS, Azure Key Vault

## Configuration

```bash
CLEF_BROKER_IDENTITY=api-gateway        # Envelope identity
CLEF_BROKER_ENVIRONMENT=production       # Envelope environment
CLEF_BROKER_KMS_PROVIDER=aws            # aws | gcp | azure
CLEF_BROKER_KMS_KEY_ID=arn:aws:kms:...  # KMS key for wrapping

# Handler config (prefix stripped, passed to create())
CLEF_BROKER_HANDLER_DB_ENDPOINT=mydb.cluster-abc.rds.amazonaws.com
CLEF_BROKER_HANDLER_DB_USER=clef_readonly
```

## Broker Registry

Browse and install ready-made broker templates:

```bash
clef search              # List available brokers
clef install rds-iam     # Download a broker template
```

Official brokers: [registry.clef.sh](https://registry.clef.sh)

## Documentation

- [Dynamic Secrets guide](https://docs.clef.sh/guide/dynamic-secrets)
- [Broker Registry](https://registry.clef.sh)
- [Contributing a broker](https://registry.clef.sh/contributing)

## License

MIT
