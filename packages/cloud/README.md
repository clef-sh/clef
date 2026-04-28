# @clef-sh/cloud

Clef Cloud integration for [Clef](https://clef.sh) — managed KMS, device-flow authentication, and artifact hosting. Ships as an optional plugin for the CLI and UI.

No secret data passes through Clef Cloud. The service manages encryption keys and serves packed artifacts — your plaintext never leaves your machine.

## Install

```bash
npm install @clef-sh/cloud
```

## Features

- **Managed KMS**: Cloud-hosted age key management with `clef cloud init --env <environment>`
- **Device-flow auth**: Browser-based login via `clef cloud login`, tokens stored locally
- **Remote packing**: `clef pack --remote` sends encrypted files to Cloud for packing and serving
- **Artifact hosting**: `clef pack --push` uploads locally packed artifacts to Cloud for serving
- **Key service**: Lazy-loaded Go binary that speaks the SOPS gRPC protocol, proxying KMS operations through the Cloud API

## Usage

```bash
clef cloud login
clef cloud init --env production
```

Once configured, standard CLI commands (`clef set`, `clef get`, `clef pack`) use Cloud KMS automatically for environments configured with the cloud backend.

## Subpath exports

- `@clef-sh/cloud` — core client: auth, credentials, pack client, artifact client
- `@clef-sh/cloud/cli` — CLI command registration (used by `@clef-sh/cli`)
- `@clef-sh/cloud/ui` — UI components for Cloud status and billing

## Documentation

- [Clef Cloud guide](https://docs.clef.sh/guide/cloud)
- [API reference](https://docs.clef.sh/api/)

## License

MIT
