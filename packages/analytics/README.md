# @clef-sh/analytics

Anonymous CLI analytics for [Clef](https://clef.sh). Collects command usage telemetry to help improve the tool. Powered by PostHog. Fully opt-out.

No secret values, file contents, key names, or repository paths are ever collected.

## Install

```bash
npm install @clef-sh/analytics
```

## What is collected

- Command name and duration
- CLI version
- OS platform and architecture
- Success/failure status

## What is never collected

- Secret values or key names
- File contents or paths
- Repository URLs or identifiers
- Environment names or namespace names

## Opt out

```bash
# Session
export CLEF_ANALYTICS=0

# Permanent
clef config set analytics false
```

## Documentation

- [Privacy & telemetry](https://docs.clef.sh/guide/telemetry)

## License

MIT
