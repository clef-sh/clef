# Lint View

The lint view is the full-repo health report. It scans every file in the matrix for issues and presents them grouped by severity with actionable fix commands. The design is modelled on ESLint: scan everything, report clearly, tell you how to fix it.

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│  Lint                                                         │
├───────────────────────────────────────────────────────────────┤
│  [All] [Errors] [Warnings] [Info]    [Matrix] [Schema] [SOPS]│
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ✗ 2 Errors                                                   │
│  ┌───────────────────────────────────────────────────────────┐│
│  │ [matrix] database/staging.enc.yaml                        ││
│  │ File is missing from the matrix.                          ││
│  │ fix: clef lint --fix                            [copy]    ││
│  │                                              [dismiss]    ││
│  ├───────────────────────────────────────────────────────────┤│
│  │ [schema] payments/production.enc.yaml  WEBHOOK_SECRET     ││
│  │ Required key 'WEBHOOK_SECRET' is missing.                 ││
│  │ fix: clef set payments/production WEBHOOK_SECRET  [copy]  ││
│  │                                              [dismiss]    ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  ⚠ 1 Warning                                                 │
│  ┌───────────────────────────────────────────────────────────┐│
│  │ [schema] auth/dev.enc.yaml  LEGACY_TOKEN                  ││
│  │ Key 'LEGACY_TOKEN' is not declared in the schema.         ││
│  │                                              [dismiss]    ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Filter bar

Two sets of filters at the top of the view:

### Severity filters (left side)

- **All** — show all issues
- **Errors** — errors only (red)
- **Warnings** — warnings only (yellow)
- **Info** — informational issues only (blue)

### Category filters (right side)

- **Matrix** — completeness issues (missing files, incomplete matrix)
- **Schema** — validation issues (missing required keys, type mismatches, undeclared keys)
- **SOPS** — encryption issues (invalid metadata, decryption failures)

Both filter sets can be combined: for example, selecting "Errors" and "Schema" shows only schema-related errors.

## Issue groups

Issues are grouped by severity and sorted within each group. Error groups appear first, then warnings, then info.

Each group has a coloured header with a count badge:

- Errors: red header with count
- Warnings: yellow header with count
- Info: blue header with count

## Issue cards

Each issue card contains:

| Element            | Description                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Category badge** | Coloured tag showing "matrix", "schema", or "sops"                                                                                            |
| **File reference** | The path to the affected file (e.g., `payments/production.enc.yaml`). Clickable — navigates to the editor for that namespace and environment. |
| **Key reference**  | The specific key involved, if applicable (e.g., `WEBHOOK_SECRET`)                                                                             |
| **Message**        | Plain-English description of the issue                                                                                                        |
| **Fix command**    | The CLI command to resolve the issue (if available), with a **copy** button                                                                   |
| **Dismiss button** | Temporarily hides the issue from the current session                                                                                          |

## Severity semantics

| Severity    | Blocks commit? | Examples                                                                           |
| ----------- | -------------- | ---------------------------------------------------------------------------------- |
| **Error**   | Yes            | Missing required key, missing matrix file, invalid SOPS metadata                   |
| **Warning** | No             | Undeclared key (key exists in file but not in schema), value exceeds schema max    |
| **Info**    | No             | Key with no schema definition, single-recipient encryption (a note, not a problem) |

## All-clear state

When every issue has been resolved (or there were none to begin with), the lint view shows:

- A large green checkmark
- The text "All clear -- N files healthy"
- The **Commit changes** button becomes active if there are uncommitted changes

This state is designed to feel like passing a test suite. The visual reward reinforces the workflow of checking lint before committing.

## CLI equivalent

The lint view corresponds to `clef lint`:

```bash
clef lint
clef lint --fix
clef lint --json
```

The UI provides the same data with interactive filtering, clickable navigation to the editor, and copy-to-clipboard fix commands.
