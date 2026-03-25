# rds-iam

## Description

Generate RDS IAM authentication tokens for connecting to Amazon RDS or Aurora databases. Tokens are valid for 15 minutes and self-expire — no revocation needed. This replaces storing a static database password.

## Prerequisites

- An RDS or Aurora instance with IAM authentication enabled
- A database user created with `GRANT rds_iam TO <user>`
- The broker's execution role must have `rds-db:connect` permission for the target database

## Configuration

| Input         | Required | Secret | Default | Description                               |
| ------------- | -------- | ------ | ------- | ----------------------------------------- |
| `DB_ENDPOINT` | Yes      | No     | —       | RDS cluster or instance endpoint hostname |
| `DB_USER`     | Yes      | No     | —       | IAM database user                         |
| `DB_PORT`     | No       | No     | `5432`  | Database port                             |

## Deploy

```bash
clef install rds-iam

# Set the database connection details
export CLEF_BROKER_HANDLER_DB_ENDPOINT="mydb.cluster-abc.us-east-1.rds.amazonaws.com"
export CLEF_BROKER_HANDLER_DB_USER="clef_readonly"

# Deploy as Lambda (see shared deployment templates)
```

## How It Works

1. The broker calls `rds-generate-db-auth-token` via the AWS SDK RDS Signer
2. AWS returns a signed token valid for 15 minutes (no database round-trip needed)
3. The broker packs the token into a Clef artifact envelope with KMS envelope encryption
4. The agent polls the broker, unwraps via KMS, and serves `DB_TOKEN` to your app
5. Your app uses `DB_TOKEN` as the password when connecting to RDS
6. The token expires naturally after 15 minutes — the agent fetches a fresh one before expiry
