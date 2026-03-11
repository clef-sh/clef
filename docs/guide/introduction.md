# Introduction

Clef is a local-first, open source tool that brings a structured UI and workflow layer on top of [Mozilla SOPS](https://github.com/getsops/sops). It makes encrypted, git-tracked secrets and configuration management ergonomic for teams — without requiring any server infrastructure, external databases, or vendor lock-in.

## The problem

SOPS is an excellent encryption engine. It encrypts individual values inside YAML and JSON files, supports multiple key management backends (age, AWS KMS, GCP KMS, PGP), and integrates naturally with git because encrypted files are just text files you commit.

But at team scale, raw SOPS falls apart:

- **No structure.** There is no standard way to organise secrets across namespaces and environments. Every team invents its own folder layout, naming scheme, and promotion workflow.
- **No visibility.** You cannot tell at a glance whether a key exists in production but not staging, or whether a required database URL is missing from a new environment. Key drift between environments is invisible until something breaks at deploy time.
- **No validation.** SOPS does not know that `DB_PORT` should be an integer or that `DATABASE_URL` must start with `postgres://`. There is no schema layer.
- **No UI.** Every operation requires memorising SOPS flags and piping YAML through the terminal. There is no way to browse, compare, or edit secrets visually.
- **No guardrails.** Nothing stops a developer from committing a plaintext secrets file, or from accidentally overwriting production credentials without a confirmation step.

Clef solves all of these problems while keeping SOPS as the encryption engine and git as the source of truth.

## Design philosophy

Three principles guide every decision in Clef:

1. **Git is the source of truth.** There is no external database, no cloud sync, no server. Your secrets live in encrypted files in your git repository. Clef is an interface on top of that reality.
2. **SOPS is the encryption engine.** Clef never implements any cryptography. All encryption and decryption is delegated to the `sops` binary via subprocess calls. Decrypted values exist only in memory and are never written to disk.
3. **CLI and UI are equal citizens.** Every action available in the web UI has an equivalent `clef` CLI command. The UI even shows you the CLI command for common operations, so you can automate them in scripts and CI.

## Competitive landscape

|                   | Clef | Vault    | Doppler | dotenv-vault | Raw SOPS |
| ----------------- | ---- | -------- | ------- | ------------ | -------- |
| Local-first       | Yes  | No       | No      | No           | Yes      |
| Git-native        | Yes  | No       | No      | Yes          | Yes      |
| UI                | Yes  | Yes      | Yes     | Yes          | No       |
| Schema validation | Yes  | No       | No      | No           | No       |
| No infrastructure | Yes  | No       | No      | No           | Yes      |
| Key management    | SOPS | Built-in | SaaS    | SaaS         | Manual   |

Clef's unique position is **"truly git-native, zero infrastructure required."** Unlike Vault or Doppler, there is no server to run. Unlike raw SOPS, there is a visual interface, schema validation, and a workflow layer that prevents mistakes.

## What Clef provides

- A **manifest** (`clef.yaml`) that declares your namespaces, environments, and encryption settings in one place
- A **namespace-by-environment matrix** that maps every secret file to its logical location and detects missing cells
- **Schema validation** that enforces required keys, types, and patterns on every namespace
- A **CLI** with nine commands covering the full secrets lifecycle: `init`, `get`, `set`, `delete`, `diff`, `lint`, `rotate`, `hooks`, and `ui`
- A **local web UI** served at `127.0.0.1` that visualises the matrix, provides inline editing with masked values, and highlights drift between environments
- A **pre-commit hook** that blocks accidental plaintext commits
- Support for all SOPS encryption backends: **age**, **AWS KMS**, **GCP KMS**, and **PGP**

## Next steps

Ready to get started? Install Clef and encrypt your first secret.

[Next: Installation](/guide/installation)
