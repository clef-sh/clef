# Namespace Editor

Tabbed interface for viewing and editing secrets across environments within a namespace.

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  database                               [Commit changes]        │
├─────────────────────────────────────────────────────────────────┤
│  DEV │ STAGING │ PRODUCTION │     encrypted with age · 2 recip  │
│  ━━━━                                                           │
├─────────────────────────────────────────────────────────────────┤
│  ⚠ PRODUCTION — Changes here affect the live system.            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Key              Value              Type      Actions           │
│  ──────────────────────────────────────────────────────────────  │
│  * DB_HOST        ●●●●●●●●●●         string    👁 🗑             │
│  * DB_PORT        ●●●●               integer   👁 🗑             │
│  * DB_PASSWORD    ●●●●●●●●●●●●       string    👁 🗑             │
│    DB_POOL_SIZE   ●●                 integer   👁 🗑             │
│  * DB_SSL         ●●●●               boolean   👁 🗑             │
│                                                                  │
│  [+ Add key]                                                     │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Schema: schemas/database.yaml                                   │
│  ✓ 5/5 required keys present · 0 warnings                       │
└─────────────────────────────────────────────────────────────────┘
```

## Environment tabs

One tab per environment, highlighted with a bottom border in its semantic colour:

- **DEV** — green (`#22C55E`)
- **STAGING** — amber (`#FBBF24`)
- **PRODUCTION** — red (`#EF4444`)

The right side shows SOPS metadata for the active file (e.g., "encrypted with age - 2 recipients").

## Production warning banner

When a protected environment tab is active, a persistent red warning banner appears:

> PRODUCTION — Changes here affect the live system.

Cannot be dismissed — ensures you are always aware when viewing or editing production secrets.

## Key table

The main editing surface is a table with four columns:

| Column      | Content                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- |
| **Key**     | The key name. Required keys (per schema) are prefixed with an amber asterisk (`*`).             |
| **Value**   | The secret value, masked by default with bullet characters (`●●●●●●`).                          |
| **Type**    | The schema-declared type (string, integer, boolean). If no schema exists, this column is empty. |
| **Actions** | Eye icon (reveal/edit) and delete icon.                                                         |

### Masked values

All values are masked by default for screen-sharing safety. Clicking the eye icon on a row reveals and makes that value editable; other rows remain masked.

### Editing a value

When you modify a value, the row enters a "dirty" state — an amber left border and dot appear, and **Commit changes** becomes active. Edits are held in memory across multiple tabs until committed.

### Adding a key

Click **+ Add key** below the table to add a new key-value pair.

### Deleting a key

Click the delete icon on a row to mark it for deletion — struck through but not removed until you commit.

## Commit flow

When any changes are pending (edits, additions, or deletions), the **Commit changes** button becomes active in the top bar. Clicking it:

1. Prompts for a commit message
2. Re-encrypts the modified files via SOPS (values are piped through stdin, never written as plaintext)
3. Stages the changed files in git
4. Creates a git commit with the provided message
5. Clears the dirty state

## Schema summary panel

Below the key table, a panel shows the schema validation status for the current file:

- The schema file path (e.g., "schemas/database.yaml")
- Required key coverage (e.g., "5/5 required keys present")
- Warning count
- A link to the [Lint View](/ui/lint-view) for detailed issue information

If the namespace has no schema, this panel shows "No schema defined".
