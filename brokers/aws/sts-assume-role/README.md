# sts-assume-role

## Description

Generate temporary AWS credentials via STS AssumeRole. Returns a short-lived access key, secret key, and session token that can be used to access any AWS service the assumed role permits. Credentials self-expire — no revocation needed.

## Prerequisites

- An IAM role with the permissions your application needs
- The broker's execution role must have `sts:AssumeRole` permission on the target role
- The target role's trust policy must allow the broker's execution role to assume it

## Configuration

| Input          | Required | Secret | Default       | Description                             |
| -------------- | -------- | ------ | ------------- | --------------------------------------- |
| `ROLE_ARN`     | Yes      | No     | —             | IAM role ARN to assume                  |
| `SESSION_NAME` | No       | No     | `clef-broker` | Session name (appears in CloudTrail)    |
| `DURATION`     | No       | No     | `3600`        | Session duration in seconds (900–43200) |

## Deploy

```bash
clef install sts-assume-role

# Set the role ARN
export CLEF_BROKER_HANDLER_ROLE_ARN="arn:aws:iam::123456789012:role/my-app-role"

# Deploy as Lambda (see shared deployment templates)
```

## How It Works

1. The broker calls `sts:AssumeRole` with the configured role ARN
2. AWS returns temporary credentials (access key + secret key + session token)
3. The broker packs them into a Clef artifact envelope with KMS envelope encryption
4. The agent polls the broker, unwraps via KMS, and serves credentials to your app
5. Credentials expire naturally at the configured duration — no cleanup needed
