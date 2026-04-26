# @clef-sh/pack-aws-secrets-manager

AWS Secrets Manager [pack backend](https://clef.sh/guide/pack-plugins) for [Clef](https://clef.sh).

Two emission modes:

- **JSON mode (default)** — all keys for a cell bundled into one ASM secret as a JSON object. Canonical ASM idiom; cheaper at scale.
- **Single mode** — one ASM secret per key. Use when per-key IAM matters.

Auth uses the AWS SDK default credential chain (env vars, SSO, IRSA, profile, IMDS).

## Install

```bash
npm install --save-dev @clef-sh/pack-aws-secrets-manager
```

## Use

```bash
AWS_REGION=us-east-1 \
  npx clef pack api-gateway production \
    --backend aws-secrets-manager \
    --backend-opt prefix=myapp/production
```

See the [full documentation](https://clef.sh/guide/pack-aws-secrets-manager) for both modes, all options, IAM requirements, and limits.

## License

MIT
