---
layout: doc
---

# Contributing a Broker

Clef welcomes community broker contributions. Each broker is a self-contained directory with three files.

## Directory Structure

Create a directory under `brokers/<provider>/<name>/`:

```
brokers/
  aws/
    your-broker/
      broker.yaml     # Manifest
      handler.ts      # Implementation
      README.md       # Documentation
```

## broker.yaml

The manifest defines metadata, inputs, outputs, and runtime dependencies.

```yaml
name: your-broker
version: 1.0.0
description: One-line description of what this broker does
author: your-github-username
license: MIT
provider: aws # aws | gcp | azure | agnostic
tier: 1 # 1 = self-expiring, 2 = stateful, 3 = complex

inputs:
  - name: INPUT_NAME
    description: What this input configures
    secret: false
    default: "optional-default"

output:
  identity: suggested-identity-name
  ttl: 3600
  keys: [OUTPUT_KEY_1, OUTPUT_KEY_2]

runtime:
  dependencies:
    some-package: "^1.0.0"
  permissions:
    - cloud:permission
```

## handler.ts

Implement the `BrokerHandler` interface from `@clef-sh/broker`:

```ts
import type { BrokerHandler } from "@clef-sh/broker";

export const handler: BrokerHandler = {
  create: async (config) => {
    // Generate credentials using config values
    return {
      data: { OUTPUT_KEY: "value" },
      ttl: 3600,
    };
  },
  // Optional: implement revoke for Tier 2 brokers
  // revoke: async (entityId, config) => { ... },
};
```

### Tier Reference

| Tier  | When to use                                              | Required methods                       |
| ----- | -------------------------------------------------------- | -------------------------------------- |
| **1** | Credentials self-expire (STS, OAuth, RDS IAM)            | `create`                               |
| **2** | Credentials need cleanup (SQL users, MongoDB users)      | `create` + `revoke`                    |
| **3** | Complex multi-step lifecycle (IAM users, LDAP, K8s RBAC) | `create` + `revoke` + state management |

## README.md

Include these required sections (validated by CI):

- **Description** — What the broker does
- **Prerequisites** — What the user needs before deploying
- **Configuration** — Input table
- **Deploy** — `clef install` command and setup steps

## Validation

Run the broker validation suite before submitting:

```bash
npx jest --config brokers/jest.config.js
```

This checks your `broker.yaml` schema, handler exports, and README structure.

## Submitting

1. Fork the repository
2. Add your broker under `brokers/<provider>/<name>/`
3. Run `npx jest --config brokers/jest.config.js` to validate
4. Open a pull request

CI will run the validation suite automatically. Maintainers review the handler logic before merging.
