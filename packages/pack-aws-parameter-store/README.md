# @clef-sh/pack-aws-parameter-store

AWS SSM Parameter Store [pack backend](https://clef.sh/guide/pack-plugins) for [Clef](https://clef.sh).

Writes one `SecureString` parameter per key under a user-supplied prefix. Auth uses the AWS SDK default credential chain.

## Install

```bash
npm install --save-dev @clef-sh/pack-aws-parameter-store
```

## Use

```bash
AWS_REGION=us-east-1 \
  npx clef pack api-gateway production \
    --backend aws-parameter-store \
    --backend-opt prefix=/myapp/production
```

See the [full documentation](https://clef.sh/guide/pack-aws-parameter-store) for all options, IAM requirements, and limits.

## License

MIT
