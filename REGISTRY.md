# Clef Broker Registry — Implementation Plan

## Overview

A community-driven registry of dynamic credential broker handlers, distributed as a GitHub repository. A broker is any HTTP endpoint that returns a valid Clef artifact envelope. `clef install <broker>` downloads a handler into the user's project. The user deploys it behind any URL. The Clef agent polls that URL — same as it polls any other artifact source.

Clef provides the **broker runtime** (`@clef-sh/broker-runtime`) — an npm package that handles envelope construction, KMS wrapping, and HTTP serving. A community broker is a single `create()` function. The runtime does the rest.

---

## The Core Contract

A broker is an HTTP endpoint. The agent polls it. The broker returns a Clef artifact envelope. That's the entire interface.

```
Agent (adaptive polling)          Broker (any HTTP endpoint)
┌──────────────────────┐          ┌──────────────────────┐
│                      │  GET     │                      │
│  Polls broker URL    │─────────►│  1. Generate cred    │
│  at 80% of TTL       │          │  2. age-encrypt      │
│                      │◄─────────│  3. KMS-wrap         │
│  Unwraps via KMS     │  200 OK  │  4. Return envelope  │
│  Decrypts via age    │  (JSON)  │                      │
│  Serves to app       │          │                      │
└──────────────────────┘          └──────────────────────┘
```

How the broker generates the credential is not Clef's concern. What infrastructure it runs on is not Clef's concern. The contract is: return a valid envelope at an HTTP URL. The agent already knows how to consume it.

A broker can be:

- A Lambda behind API Gateway (or a Function URL)
- A Cloud Function behind its default HTTPS trigger
- A container with an HTTP server
- A plain process on a VM
- Anything that responds to HTTP with a valid envelope

No EventBridge. No S3 bucket. No cron job. The agent's adaptive polling is the scheduler.

---

## The Broker Runtime

The `@clef-sh/broker-runtime` package is the key to reducing adoption burden. It handles everything except the credential generation logic.

### What the runtime does

1. **HTTP serving** — Starts a server, handles the agent's GET requests
2. **Config loading** — Reads broker inputs from environment variables or the Clef agent
3. **Envelope construction** — age-encrypts credentials with an ephemeral key
4. **KMS wrapping** — Wraps the ephemeral private key via KMS
5. **Response caching** — Caches the generated envelope until TTL threshold, avoiding redundant credential generation on every poll
6. **Health endpoint** — `GET /health` for infrastructure probes

### What the broker author writes

A single handler file conforming to the `BrokerHandler` interface:

```typescript
import type { BrokerHandler } from "@clef-sh/broker-runtime";

export interface BrokerHandler {
  create(config: Record<string, string>): Promise<{
    data: Record<string, string>; // the credentials
    ttl: number; // seconds until expiry
  }>;

  revoke?(entityId: string, config: Record<string, string>): Promise<void>;

  validateConnection?(config: Record<string, string>): Promise<boolean>;
}
```

**`create`** is the only required method. `revoke` and `validateConnection` are optional — most Tier 1 brokers (self-expiring credentials) don't need them.

### Example: RDS IAM broker (complete handler)

```typescript
import { Signer } from "@aws-sdk/rds-signer";
import type { BrokerHandler } from "@clef-sh/broker-runtime";

export const handler: BrokerHandler = {
  create: async (config) => {
    const signer = new Signer({
      hostname: config.DB_ENDPOINT,
      port: Number(config.DB_PORT ?? "5432"),
      username: config.DB_USER,
    });
    return {
      data: { DB_TOKEN: await signer.getAuthToken() },
      ttl: 900,
    };
  },
};
```

15 lines. No envelope logic, no KMS calls, no HTTP server code, no S3 writes.

### Example: SQL database broker (Handlebars templates)

The SQL broker uses statement templates — one provider covers every SQL database:

```yaml
# broker.yaml
name: sql-database
provider: agnostic
inputs:
  - name: DB_HOST
    secret: false
  - name: DB_PORT
    secret: false
    default: "5432"
  - name: DB_ADMIN_USER
    secret: true
  - name: DB_ADMIN_PASSWORD
    secret: true
  - name: DB_NAME
    secret: false
  - name: CREATE_STATEMENT
    secret: false
    default: |
      CREATE ROLE "{{username}}" WITH LOGIN PASSWORD '{{password}}'
      VALID UNTIL '{{expiration}}';
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{{username}}";
  - name: REVOKE_STATEMENT
    secret: false
    default: |
      DROP ROLE IF EXISTS "{{username}}";
```

```typescript
import type { BrokerHandler } from "@clef-sh/broker-runtime";
import Handlebars from "handlebars";
import { randomBytes } from "node:crypto";
import knex from "knex";

export const handler: BrokerHandler = {
  create: async (config) => {
    const username = `clef_${Date.now()}`;
    const password = randomBytes(24).toString("base64url");
    const expiration = new Date(Date.now() + 3600_000).toISOString();

    const db = knex({
      client: "pg",
      connection: {
        /* from config */
      },
    });
    const sql = Handlebars.compile(config.CREATE_STATEMENT)({ username, password, expiration });
    await db.raw(sql);
    await db.destroy();

    return {
      data: { DB_USER: username, DB_PASSWORD: password },
      ttl: 3600,
    };
  },

  revoke: async (entityId, config) => {
    const db = knex({
      client: "pg",
      connection: {
        /* from config */
      },
    });
    const sql = Handlebars.compile(config.REVOKE_STATEMENT)({ username: entityId });
    await db.raw(sql);
    await db.destroy();
  },
};
```

One handler, every SQL database. The user changes the `CREATE_STATEMENT` and `REVOKE_STATEMENT` for MySQL, Oracle, MSSQL — the handler doesn't change.

### How the runtime executes

```typescript
import { serve } from "@clef-sh/broker-runtime";
import { handler } from "./handler.js";

serve(handler, { port: process.env.PORT ?? 8080 });
```

That's the entrypoint. `serve()` does:

1. Loads config from env vars (or Clef agent if `CLEF_AGENT_URL` is set)
2. On GET `/`: calls `handler.create(config)` → encrypts → KMS wraps → returns envelope JSON
3. Caches the response until 80% of TTL has elapsed (avoids generating new credentials on every poll)
4. On GET `/health`: returns 200
5. If `handler.revoke` exists and the broker manages stateful credentials (SQL users), tracks `entityId` and calls `revoke` on the previous credential when a new one is created

---

## The Registry

A public GitHub repository (`clef-sh/brokers`) containing one directory per broker. The registry is the repo — no API server, no database, no CDN. Discovery is via an auto-generated `index.json` at the repo root.

```
github.com/clef-sh/brokers/
├── index.json                    ← auto-generated by CI from broker.yaml files
├── aws/
│   ├── rds-iam/
│   │   ├── broker.yaml
│   │   ├── handler.ts
│   │   └── README.md
│   ├── sts-assume-role/
│   └── secrets-manager-passthrough/
├── gcp/
│   ├── cloud-sql-iam/
│   └── workload-identity-token/
├── azure/
│   └── entra-id-token/
└── agnostic/
    ├── sql-database/
    ├── oauth-token-refresh/
    └── jwt-minter/
```

Note: no `deploy/` subdirectory per broker. The deployment template is **one shared template** in the runtime package (or a top-level `deploy/` in the registry) parameterized by broker name. The handler is the only broker-specific code.

### Contribution Model

Fork and PR. Same as Homebrew formulas.

1. Contributor forks `clef-sh/brokers`
2. Adds a directory under the appropriate cloud provider (or `agnostic/`)
3. Includes `broker.yaml` + `handler.ts` + `README.md`
4. Opens a PR
5. CI validates: `broker.yaml` schema, handler type-checks against `BrokerHandler`, README structure
6. Maintainers review the handler logic
7. On merge, CI regenerates `index.json`

The barrier to contribution is writing a `create()` function — not understanding age encryption, KMS, or the artifact envelope format.

---

## The broker.yaml Manifest

Every broker must have a `broker.yaml` at its root.

```yaml
name: rds-iam
version: 1.0.0
description: Generate RDS IAM authentication tokens with 15-minute TTL
author: clef-sh
license: MIT
provider: aws
tier: 1 # 1 = self-expiring, 2 = stateful (needs revoke), 3 = complex lifecycle

inputs:
  - name: DB_ENDPOINT
    description: RDS cluster endpoint
    secret: false
  - name: DB_USER
    description: IAM database user
    secret: false
  - name: DB_PORT
    description: Database port
    secret: false
    default: "5432"

output:
  identity: rds-primary
  ttl: 900
  keys: [DB_TOKEN]

runtime:
  dependencies:
    "@aws-sdk/rds-signer": "^3.0.0"
  permissions:
    - rds-db:connect # IAM permissions the broker's execution role needs
```

### Field Definitions

| Field                  | Required | Description                                                                                |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `name`                 | Yes      | Unique broker identifier (lowercase, hyphens)                                              |
| `version`              | Yes      | Semver version                                                                             |
| `description`          | Yes      | One-line description                                                                       |
| `author`               | Yes      | Author or organization                                                                     |
| `license`              | Yes      | SPDX license identifier                                                                    |
| `provider`             | Yes      | Target cloud (`aws`, `gcp`, `azure`, `agnostic`)                                           |
| `tier`                 | Yes      | `1` (self-expiring), `2` (stateful/revocable), `3` (complex lifecycle)                     |
| `inputs`               | Yes      | Parameters the broker needs — `secret: true` means it should be stored in a Clef namespace |
| `inputs[].default`     | No       | Default value if not provided                                                              |
| `output.identity`      | No       | Suggested service identity name for the output artifact                                    |
| `output.ttl`           | No       | Suggested TTL in seconds for the output artifact                                           |
| `output.keys`          | No       | Secret key names the broker produces                                                       |
| `runtime.dependencies` | No       | npm dependencies the handler needs (installed by the runtime)                              |
| `runtime.permissions`  | No       | IAM permissions the broker's execution role needs (documentation, not enforcement)         |

### Input Types

- `secret: false` — configuration value (endpoint, username, region). Environment variable or deployment parameter.
- `secret: true` — sensitive credential (database password, OAuth client secret). Stored in a Clef namespace and read via the agent at runtime.

---

## Broker Tiers

| Tier  | Credential Type     | Revocation                                   | Examples                                                                     | Complexity                                                             |
| ----- | ------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **1** | Self-expiring       | None needed — credentials expire naturally   | STS AssumeRole, RDS IAM, OAuth access tokens, GCP access tokens              | Handler is a pure function. `create()` only.                           |
| **2** | Stateful, revocable | Create-new, revoke-previous                  | SQL database users, MongoDB users, Redis ACL users                           | Handler has `create()` + `revoke()`. Runtime tracks previous entityId. |
| **3** | Complex lifecycle   | Multi-step teardown or external coordination | IAM users (detach policies, delete keys, remove from groups), LDAP, K8s RBAC | Advanced. Handler manages full lifecycle. May need external state.     |

**Phase 1 focuses on Tier 1.** These cover the most common real-world use cases and require zero state management. Tier 2 (SQL templates) is Phase 1 stretch. Tier 3 is future work.

---

## The `clef install` Command

### Behavior

```bash
$ clef install rds-iam

  Fetching rds-iam from clef-sh/brokers...

  Name:        rds-iam
  Provider:    aws
  Tier:        1 (self-expiring credentials)
  Description: Generate RDS IAM authentication tokens with 15-minute TTL

  Created:
    brokers/rds-iam/broker.yaml
    brokers/rds-iam/handler.ts

  Inputs:
    DB_ENDPOINT  (required)
    DB_USER      (required)
    DB_PORT      (default: 5432)

  Output:
    Keys:    DB_TOKEN
    TTL:     900s

  IAM permissions needed:
    rds-db:connect

  Deploy:
    See: https://registry.clef.sh/brokers/rds-iam#deploy
```

### Implementation

```typescript
// packages/cli/src/commands/install.ts

interface BrokerManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  provider: string;
  tier: 1 | 2 | 3;
  inputs: { name: string; description: string; secret: boolean; default?: string }[];
  output?: { identity?: string; ttl?: number; keys?: string[] };
  runtime?: {
    dependencies?: Record<string, string>;
    permissions?: string[];
  };
}
```

**Steps:**

1. Fetch `index.json` from `https://raw.githubusercontent.com/clef-sh/brokers/main/index.json`
2. Look up the broker name in the index to get the directory path
3. Download `broker.yaml`, `handler.ts`, `README.md` (3 files — not a project scaffold)
4. Write files to `brokers/<name>/` in the user's repo
5. Parse `broker.yaml` and print summary
6. Exit — no deployment, no cloud calls

**Additional commands:**

- `clef search <query>` — search the index by name, provider, or description
- `clef search --provider aws` — filter by cloud provider
- `clef search --tier 1` — filter by complexity tier

---

## Deployment

Clef does not deploy brokers. But because every broker uses the same runtime, deployment is a generic template parameterized by broker name — not a per-broker IaC project.

### Shared deployment templates

The `@clef-sh/broker-runtime` package (or a `deploy/` directory in the registry) provides generic deployment templates:

**AWS Lambda + Function URL (SAM):**

```yaml
# deploy/sam/template.yaml — works for ANY broker
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31

Parameters:
  BrokerName:
    Type: String
  KmsKeyArn:
    Type: String
  # ... broker inputs injected as env vars

Resources:
  BrokerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Runtime: nodejs20.x
      Handler: index.handler
      CodeUri: ./brokers/${BrokerName}/
      Layers:
        - !Ref BrokerRuntimeLayer
      Environment:
        Variables:
          KMS_KEY_ARN: !Ref KmsKeyArn
      FunctionUrlConfig:
        AuthType: AWS_IAM # agent authenticates via IAM
```

**Dockerfile (generic — works for any broker):**

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY brokers/<name>/handler.ts .
COPY brokers/<name>/broker.yaml .
RUN npm install @clef-sh/broker-runtime
CMD ["node", "-e", "import('./handler.js').then(h => require('@clef-sh/broker-runtime').serve(h.handler))"]
```

The handler is the only broker-specific code. Everything else is shared infrastructure.

---

## Broker Config as Clef Secrets

When a broker has inputs with `secret: true`, the recommended pattern is:

1. Store root credentials in a Clef namespace: `clef set broker-rds-iam/production DB_ADMIN_PASSWORD "..."`
2. The broker reads them from environment variables (injected by the deployment template) or from the Clef agent if running as a sidecar
3. The broker runtime passes them to `handler.create(config)`

The broker consumes static secrets (managed by Clef) to produce dynamic credentials (delivered by Clef). Same agent, same envelope, same consumption path.

---

## Registry Index (index.json)

Auto-generated by CI on every merge to `main`:

```json
{
  "version": 1,
  "generatedAt": "2026-03-24T...",
  "brokers": [
    {
      "name": "rds-iam",
      "version": "1.0.0",
      "description": "Generate RDS IAM authentication tokens with 15-minute TTL",
      "author": "clef-sh",
      "provider": "aws",
      "tier": 1,
      "path": "aws/rds-iam",
      "outputKeys": ["DB_TOKEN"]
    },
    {
      "name": "sql-database",
      "version": "1.0.0",
      "description": "Dynamic SQL database credentials via Handlebars templates",
      "author": "clef-sh",
      "provider": "agnostic",
      "tier": 2,
      "path": "agnostic/sql-database",
      "outputKeys": ["DB_USER", "DB_PASSWORD"]
    }
  ]
}
```

---

## Implementation Phases

### Phase 1: Broker Runtime + Registry + Reference Brokers

**Scope:**

- `@clef-sh/broker-runtime` npm package:
  - `BrokerHandler` interface (create, revoke?, validateConnection?)
  - `serve(handler)` — HTTP server + envelope construction + KMS wrapping + response caching
  - Envelope construction extracted from `@clef-sh/core` packer
  - Published to npm
- Create `clef-sh/brokers` repository
- Reference Tier 1 brokers (handler-only, ~15-30 lines each):
  - `aws/rds-iam` — RDS IAM auth token
  - `aws/sts-assume-role` — STS temporary credentials
  - `agnostic/oauth-token-refresh` — OAuth client_credentials token
- Shared deployment templates (SAM + Dockerfile)
- `clef install <name>` + `clef search` CLI commands
- CI: index generator + `broker.yaml` schema validation + handler type-check
- CONTRIBUTING.md with broker authoring guidelines

**The runtime is Phase 1, not Phase 2.** Without it, every broker is 500 lines of boilerplate. With it, a broker is a `create()` function. The runtime is what makes the registry viable.

**Complexity:** Medium (~5-7 days)

- Broker runtime: ~2-3 days (envelope logic exists in core, needs extraction + HTTP serving layer)
- CLI commands: ~200 lines (install + search)
- Reference brokers: ~30 lines each
- Shared deployment templates: ~1 day
- CI + documentation: ~1 day

### Phase 2: SQL Templates + Tier 2 + Registry Site

**Scope — SQL template broker:**

- `agnostic/sql-database` broker with Handlebars statement templates
- Covers Postgres, MySQL, Oracle, MSSQL via user-provided SQL statements
- Tier 2: runtime tracks previous entityId, calls `revoke()` on rotation

**Scope — Additional brokers:**

- `gcp/workload-identity-token` — GCP access token via service account impersonation
- `agnostic/mongodb` — Dynamic MongoDB users
- `agnostic/redis-acl` — Dynamic Redis ACL users

**Scope — Static site (`registry.clef.sh`):**

- VitePress site generated from `broker.yaml` + `README.md`
- Each broker gets a page at `registry.clef.sh/brokers/<name>`
- Searchable index with provider and tier filters
- Deployed to Cloudflare Pages on merge to `main`

**Complexity:** Medium (~5-7 days)

### Phase 3: Validation + Community + Advanced Brokers

**Scope:**

- Broker testing framework — CI runs `handler.create()` in a sandbox to verify envelope shape
- Community contribution guidelines (PR templates, review checklist)
- Tier 3 brokers for complex lifecycle credentials (K8s service accounts, LDAP)
- Private registry support (`clef install --registry <url>`)
- Site enhancements: categories, "recently added", contributor profiles

**Complexity:** Medium (~4-5 days)

### Phase 4: Clef Pro Integration

**Scope:**

- Clef Pro shows installed brokers per repo (from `clef report` data)
- Broker health monitoring (artifact freshness, generation errors via OTLP)
- Policy enforcement on broker output (TTL minimums, required KMS wrapping)

**Complexity:** Depends on Clef Pro control plane readiness

---

## Design Decisions

| Decision                | Choice                           | Rationale                                                             |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------- |
| Broker contract         | HTTP endpoint returning envelope | Agent already polls HTTP — no new protocol, no S3, no cron            |
| Broker runtime          | Phase 1, required                | Without it, adoption burden is too high — every broker is boilerplate |
| Registry infrastructure | GitHub repo                      | Zero ops, community PRs, git versioning                               |
| Contribution model      | Fork + PR                        | Barrier is writing a `create()` function, not understanding age/KMS   |
| Deployment templates    | Shared, not per-broker           | One SAM/Dockerfile template works for all brokers                     |
| Handler interface       | create + optional revoke         | Mirrors what every secrets manager converges on                       |
| SQL broker              | Handlebars statement templates   | One provider covers every SQL database                                |
| Tier system             | 1/2/3 by credential lifecycle    | Sets expectations: Tier 1 is trivial, Tier 3 is advanced              |
| Handler language        | TypeScript (runtime is Node)     | Matches Clef ecosystem; community can wrap any language behind HTTP   |
| Revocation model        | Create-new, revoke-previous      | Works in stateless serverless; no job queue needed                    |

---

## Comparison with Infisical

Infisical's dynamic secrets system supports ~22 credential providers. Their provider interface (`create`, `revoke`, `renew`, `validateInputs`, `validateConnection`) is a useful reference for the `BrokerHandler` contract. However, the architectures are fundamentally different:

| Aspect                  | Infisical                                    | Clef                                                 |
| ----------------------- | -------------------------------------------- | ---------------------------------------------------- |
| Execution               | Server-side, centralized                     | Customer-side, any HTTP endpoint                     |
| Root credential custody | Infisical server holds all root creds        | Customer's environment only                          |
| Revocation              | pgboss job queue on Infisical server         | Self-expiring (Tier 1) or create-and-revoke (Tier 2) |
| Provider code           | Enterprise-licensed (`ee/`), not reusable    | Clean-room MIT implementations                       |
| Adding a provider       | Modify Infisical source code                 | Fork registry, add a `create()` function             |
| Blast radius            | Infisical server compromise = all root creds | One broker compromise = one credential source        |

The credential generation logic itself is trivial in every case — it's SDK calls to the target system. Infisical's implementations cannot be reused (enterprise license), but the same ~15-30 lines of SDK code can be written clean-room from public cloud documentation.

---

## Open Questions

1. **Response caching in the runtime:** When the agent polls, should the broker generate fresh credentials every time, or cache the envelope until ~80% of TTL? Caching reduces load on the target system but means multiple agents may share a credential window.

2. **Authentication on the broker URL:** Lambda Function URLs support AWS_IAM auth. For other deployments, should the runtime support bearer token auth? Or is network-level isolation (VPC, security groups) sufficient?

3. **Broker versioning:** Latest-only for v1? Or should `clef install rds-iam@1.2.0` pin a version?

4. **Private registries:** `clef install --registry <url>` for organizations with internal brokers. Phase 3.

5. **State for Tier 2 brokers:** Where does the runtime store the previous `entityId` for create-and-revoke? A small state file in the broker's environment (Lambda `/tmp`, container volume)? Or in the envelope metadata itself?
