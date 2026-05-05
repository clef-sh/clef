# @clef-sh/core

Core library for [Clef](https://clef.sh) — git-native secrets management built on [CNCF SOPS](https://github.com/getsops/sops).

Provides manifest parsing, matrix management, SOPS encryption/decryption, schema validation, diffing, linting, secret scanning, import/export, recipient management, and more. Used by [`@clef-sh/cli`](https://www.npmjs.com/package/@clef-sh/cli) and the local web UI.

## Install

```bash
npm install @clef-sh/core
```

## Prerequisites

- [SOPS](https://github.com/getsops/sops) v3.8+ on `PATH`
- [age](https://age-encryption.org) (or another SOPS-supported backend)

## Usage

All SOPS and git subprocess calls go through the `SubprocessRunner` interface, so you can inject your own implementation or use the Node.js one from `@clef-sh/cli`.

```typescript
import { ManifestParser, MatrixManager, SopsClient, LintRunner, DiffEngine } from "@clef-sh/core";
```

### Parse a manifest

```typescript
const parser = new ManifestParser();
const manifest = await parser.parse("/path/to/repo");
```

### Resolve the matrix

```typescript
const matrix = new MatrixManager(manifest, "/path/to/repo");
const cells = matrix.resolve(); // MatrixCell[]
```

### Decrypt a secret

```typescript
const sops = new SopsClient(runner);
const data = await sops.decrypt("/path/to/repo/database/production.enc.yaml");
console.log(data["DB_PASSWORD"]);
```

### Diff two environments

```typescript
const diff = new DiffEngine(sops);
const result = await diff.compare(cellA, cellB);
```

### Lint the repo

```typescript
const lint = new LintRunner(parser, matrix, sops, schemaValidator);
const results = await lint.run("/path/to/repo");
```

### Scan for leaked secrets

```typescript
import { ScanRunner } from "@clef-sh/core";

const scanner = new ScanRunner();
const result = await scanner.scan("/path/to/repo", { severity: "all" });
```

## API

| Class / Module      | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `ManifestParser`    | Parse and validate `clef.yaml`                                |
| `MatrixManager`     | Resolve namespace × environment grid, scaffold files          |
| `SopsClient`        | Encrypt/decrypt via SOPS subprocess (plaintext never on disk) |
| `SchemaValidator`   | Validate decrypted values against YAML schemas                |
| `DiffEngine`        | Compare secrets between two environments                      |
| `LintRunner`        | Full matrix health checks (completeness, schema, SOPS)        |
| `GitIntegration`    | Stage, commit, status, pre-commit hooks                       |
| `ScanRunner`        | Detect plaintext secrets via entropy + pattern matching       |
| `ImportRunner`      | Import from `.env`, JSON, or YAML                             |
| `ConsumptionClient` | Prepare secrets for `exec` injection                          |
| `RecipientManager`  | Add, remove, and list age recipients                          |
| `SopsMergeDriver`   | Three-way merge driver for git conflicts                      |

Full API documentation: [clef.sh/api](https://clef.sh/docs/api/)

## License

MIT
