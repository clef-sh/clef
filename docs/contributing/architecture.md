# Architecture

This page describes Clef's internal architecture: how the packages relate to each other, how data flows through the system, and how subprocess isolation works.

## High-level overview

```
┌─────────────────────────────────────────────────────┐
│                    User Interfaces                   │
│                                                      │
│   ┌──────────────┐          ┌──────────────────┐    │
│   │   CLI Layer  │          │  Local Web UI     │    │
│   │  (commander) │          │  (React + Express)│    │
│   └──────┬───────┘          └────────┬─────────┘    │
└──────────┼──────────────────────────┼───────────────┘
           │                          │
           ▼                          ▼
┌─────────────────────────────────────────────────────┐
│                    Core Library                      │
│                                                      │
│  ManifestParser  │  MatrixManager  │  SchemaValidator│
│  DiffEngine      │  BulkOps        │  GitIntegration │
│  LintRunner      │  SopsClient     │                 │
└──────────────────────────┬──────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ SOPS binary│  │ git binary │  │ Filesystem  │
    └────────────┘  └────────────┘  └────────────┘
```

Both the CLI and the UI are thin interface layers. All business logic lives in `packages/core`. This ensures that every operation available in the UI is also available in the CLI, and that behaviour is consistent between them.

## Module map

### ManifestParser (`packages/core/src/manifest/parser.ts`)

Loads and validates `clef.yaml`. Parses the YAML, validates all required fields, checks for duplicates, and returns a typed `ClefManifest` object.

### SopsClient (`packages/core/src/sops/client.ts`)

Thin subprocess wrapper around the `sops` binary. Provides three operations:

- **decrypt(filePath)** — calls `sops decrypt` and returns decrypted values in memory
- **encrypt(filePath, values, manifest)** — pipes plaintext YAML through `sops encrypt` via stdin and writes the encrypted output to disk
- **reEncrypt(filePath, newKey)** — calls `sops rotate` to add a new recipient

The SopsClient takes a `SubprocessRunner` as a constructor dependency, enabling full mocking in tests.

### MatrixManager (`packages/core/src/matrix/manager.ts`)

Resolves the namespace-by-environment matrix from the manifest and file system. Determines which cells exist, which are missing, and scaffolds new cells by creating empty encrypted files.

### SchemaValidator (`packages/core/src/schema/validator.ts`)

Loads schema YAML files and validates decrypted key-value pairs against them. Produces typed `ValidationResult` objects with errors and warnings.

### DiffEngine (`packages/core/src/diff/engine.ts`)

Decrypts two files (same namespace, different environments) and compares their keys. Classifies each key as changed, identical, missing in A, or missing in B.

### BulkOps (`packages/core/src/bulk/ops.ts`)

Multi-file operations: set a key across all environments, delete a key across all environments.

### GitIntegration (`packages/core/src/git/integration.ts`)

Wrapper around the `git` binary for commits, status, log, diff, and pre-commit hook installation.

### LintRunner (`packages/core/src/lint/runner.ts`)

Orchestrates a full repo validation by combining MatrixManager (completeness), SchemaValidator (schema compliance), and SopsClient (encryption integrity).

## Data flow: `clef set`

```
User runs: clef set payments/staging STRIPE_KEY sk_test_123
   │
   ▼
CLI (commander.js)
   │  Parse arguments: namespace=payments, env=staging,
   │                    key=STRIPE_KEY, value=sk_test_123
   ▼
ManifestParser.parse("clef.yaml")
   │  Returns ClefManifest with environments, namespaces, sops config
   ▼
MatrixManager.isProtectedEnvironment(manifest, "staging")
   │  Returns false — no confirmation needed
   ▼
SopsClient.decrypt("payments/staging.enc.yaml")
   │  Subprocess: sops decrypt --output-type yaml payments/staging.enc.yaml
   │  Returns: { values: { EXISTING_KEY: "old" }, metadata: {...} }
   ▼
Modify values in memory: values["STRIPE_KEY"] = "sk_test_123"
   │  Plaintext exists ONLY in this in-memory object
   ▼
SopsClient.encrypt("payments/staging.enc.yaml", values, manifest)
   │  Subprocess: echo <yaml> | sops encrypt --input-type yaml
   │              --output-type yaml --filename-override <path>
   │  SOPS reads plaintext from stdin, writes encrypted YAML to stdout
   │  Clef writes stdout to disk via tee
   ▼
formatter.success("Set payments/staging STRIPE_KEY")
   │  Note: the value is NEVER printed
   ▼
Done. Plaintext object is garbage collected.
```

Key security property: plaintext values exist only in the Node.js process memory. They are piped to SOPS via stdin and never written to temporary files or logged.

## Data flow: `clef ui` (API request)

```
Browser: GET /api/namespace/payments/staging
   │
   ▼
Express router (127.0.0.1:7777)
   │
   ▼
ManifestParser.parse("clef.yaml")
   │
   ▼
SopsClient.decrypt("payments/staging.enc.yaml")
   │  Subprocess: sops decrypt --output-type yaml payments/staging.enc.yaml
   │  Returns decrypted values in memory
   ▼
JSON response: { values: { STRIPE_KEY: "sk_test_123", ... }, metadata: {...} }
   │  Sent over 127.0.0.1 loopback only
   ▼
Browser renders masked values in the editor
```

The API server binds exclusively to `127.0.0.1`. Decrypted values travel only over the local loopback interface.

## Dependency injection

External subprocess calls (SOPS, git) are isolated behind the `SubprocessRunner` interface:

```typescript
interface SubprocessRunner {
  run(command: string, args: string[], options?: SubprocessOptions): Promise<SubprocessResult>;
}
```

In production, `NodeSubprocessRunner` uses `child_process.spawn` to execute real binaries. In tests, a mock implementation is injected that returns predefined results without spawning any processes.

This pattern is critical for two reasons:

1. **Testability** — unit tests run without SOPS or git installed
2. **Security** — the interface makes it explicit which subprocess calls are allowed, and ensures all SOPS interaction goes through the same code path (preventing accidental plaintext leaks)

## Package dependency graph

```
@clef-sh/cli
   ├── @clef-sh/core    (business logic)
   └── @clef-sh/ui      (server + React build)
          └── @clef-sh/core    (business logic)
```

The core library has no dependencies on CLI or UI. The CLI depends on both core and UI (for the `clef ui` command). The UI depends on core for its API server.

## Supported repository patterns

Clef supports two deployment patterns:

### Pattern A — Co-located

Secrets live in the same repository as application code. `clef.yaml` is at the repo root alongside `src/`, `package.json`, etc. This is the default — `process.cwd()` is the repo root, and no extra flags are needed.

### Pattern B — Standalone secrets repository

Secrets live in a dedicated repository. Application repos use `--repo <path>` on every Clef command to point at the secrets checkout:

```bash
clef --repo ../acme-secrets exec payments/production -- ./deploy.sh
```

The `--repo` flag is implemented as a global option on the root Commander program. Each command reads `program.opts().repo || process.cwd()` to determine the repo root. This means the flag works uniformly with every command without per-command opt-in.

In CI, Pattern B requires checking out both repositories. See the [CI/CD Integration guide](/guide/ci-cd#pattern-b-standalone-secrets-repository) for examples.

## Design decisions

Certain architectural choices are intentional and permanent. They should not be revisited without a compelling reason and broad consensus.

### All namespaces are encrypted

Clef does not support an `encrypted: false` option on namespace definitions. Every file in the matrix is encrypted by SOPS, without exception. This simplifies the security model, the pre-commit hook, and the linting logic. Non-sensitive configuration that does not need encryption should live outside the Clef matrix entirely.

See [Core Concepts — Design decision: all namespaces are encrypted](/guide/concepts#design-decision-all-namespaces-are-encrypted) for the full rationale.

### Memory clearing

Clef does not explicitly zero decrypted values in memory after use. Node.js strings are immutable and managed by the V8 garbage collector, so there is no reliable way to scrub them from the heap on demand.

This is a known platform limitation, not an oversight. Decrypted values exist only as in-process variables — they are never written to disk as plaintext — but they may remain in memory until garbage-collected.

If your threat model requires defence against memory-scraping attacks on the machine running Clef, consider:

- Running `clef exec` in a short-lived CI container that is discarded after the job completes.
- Using the UI server's session timeout (if added in a future release) to force process restart.
- Avoiding long-lived processes that hold decrypted data.

This limitation applies equally to every Node.js tool that handles secrets, including SOPS wrappers, dotenv loaders, and cloud SDK credential helpers.
