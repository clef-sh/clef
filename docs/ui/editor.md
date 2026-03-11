# Namespace Editor

The namespace editor is where developers spend most of their time in the Clef UI. It provides a tabbed interface for viewing and editing secrets across environments within a single namespace.

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

One tab per environment defined in the manifest. The active tab is highlighted with a bottom border in the environment's semantic colour:

- **DEV** — green (`#22C55E`)
- **STAGING** — amber (`#FBBF24`)
- **PRODUCTION** — red (`#EF4444`)

The right side of the tab strip shows SOPS metadata for the active file: the encryption backend and recipient count (e.g., "encrypted with age - 2 recipients").

## Production warning banner

When the production tab (or any protected environment tab) is active, a persistent red warning banner appears below the tabs:

> PRODUCTION — Changes here affect the live system.

This banner cannot be dismissed. It makes editing production feel meaningfully different from editing dev, without blocking the workflow. The intent is that you should always be aware when you are looking at or editing production secrets.

## Key table

The main editing surface is a table with four columns:

| Column      | Content                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- |
| **Key**     | The key name. Required keys (per schema) are prefixed with an amber asterisk (`*`).             |
| **Value**   | The secret value, masked by default with bullet characters (`●●●●●●`).                          |
| **Type**    | The schema-declared type (string, integer, boolean). If no schema exists, this column is empty. |
| **Actions** | Eye icon (reveal/edit) and delete icon.                                                         |

### Masked values

All values are masked by default. This makes the editor safe for screen sharing and over-the-shoulder situations. To see or edit a value, click the eye icon on that specific row. This:

1. Reveals the actual value in a text input field
2. Makes the value editable
3. Only applies to that row — other values remain masked

### Editing a value

When you reveal and modify a value, the row immediately enters a "dirty" state:

- An amber left border appears on the row
- An amber dot appears next to the key name
- The **Commit changes** button appears (or updates) in the top bar

Edits are held in memory until you commit them. You can edit multiple values across multiple environment tabs before committing.

### Adding a key

Click the **+ Add key** button below the table to add a new key-value pair. A new row appears with empty fields for the key name and value.

### Deleting a key

Click the delete (trash) icon on a row to mark it for deletion. The row is visually struck through but not removed until you commit.

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

If the namespace has no schema, this panel shows "No schema defined" with a note that schema validation is optional.
