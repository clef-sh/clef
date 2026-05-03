# Matrix View

The matrix view is the home screen of the Clef UI. It answers the question "is my repo healthy?" in a single glance by showing every namespace-by-environment cell with its status.

## Layout

> **13 healthy · 2 missing keys · 1 warning**

| Namespace    | DEV               | STAGING           | PRODUCTION            |
| ------------ | ----------------- | ----------------- | --------------------- |
| **database** | ● 5 keys · 2h ago | ● 5 keys · 1d ago | ● 5 keys · 3d ago     |
| **payments** | ● 3 keys · 1h ago | ● 3 keys · 1h ago | ⚠ 4 keys · -1 missing |
| **auth**     | ● 7 keys · 5m ago | ● 7 keys · 5m ago | ⚠ 7 keys · 1 warn     |

## Summary pills

Three pills at the top of the screen give an at-a-glance count across the full matrix:

- **Healthy** (green) — cells with no issues
- **Missing keys** (red) — cells where a required key is absent
- **Warnings** (yellow) — cells with non-blocking issues (undeclared keys, schema warnings)

The summary pills update live as you make changes in other views.

## The matrix grid

The grid has namespaces as rows and environments as columns. Each cell shows:

- **Status dot** — green for healthy, red for errors, yellow for warnings. The dot has a subtle glow matching its colour.
- **Key count** — how many keys are in the encrypted file (e.g., "5 keys")
- **Last modified** — relative timestamp of the file's last modification (e.g., "2h ago")
- **Problem badge** — if there are issues, an inline badge appears (e.g., "-1 missing", "1 warn")

Environment column headers show the environment badge with its semantic colour: DEV in green, STG in amber, PRD in red.

## Interactions

### Clicking a row

Clicking anywhere on a namespace row navigates to the [Namespace Editor](/ui/editor) for that namespace, with the first environment tab selected.

### Diff button

Each namespace row has a diff button (visible on hover) that navigates to the [Diff View](/ui/diff-view) with that namespace pre-selected.

### Missing cells

If a cell is missing entirely (the encrypted file does not exist), it appears with a red "missing" indicator and no key count. This makes it immediately obvious when someone added a new namespace but forgot to scaffold all environments.

## What the matrix reveals

The matrix makes two project-level problems visible that aren't visible from any single encrypted file:

1. **Missing cells** — a namespace/environment combination that has no file on disk. This usually means the matrix is incomplete after adding a new namespace or environment.

2. **Key drift** — a cell with fewer keys than its siblings in the same namespace. For example, if `database/dev` has 5 keys but `database/production` has only 4, the production cell shows a "-1 missing" badge. This means a key was added to dev but never promoted.

Both problems are also caught by `clef lint`, but the matrix view makes them visually obvious without running a command.
