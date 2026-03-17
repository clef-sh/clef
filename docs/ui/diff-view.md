# Diff View

Side-by-side comparison of two environments for a namespace, with status indicators and fix hints.

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│  Diff                                                         │
├───────────────────────────────────────────────────────────────┤
│  Namespace: [payments ▼]   A: [dev ▼]    B: [production ▼]   │
├───────────────────────────────────────────────────────────────┤
│  3 changed  │  1 missing in dev  │  1 identical               │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  Key               dev                production    Status    │
│  ────────────────────────────────────────────────────────────  │
│  STRIPE_KEY        sk_test_abc123     sk_live_xyz   changed   │
│  STRIPE_PUB        pk_test_abc123     pk_live_xyz   changed   │
│  WEBHOOK_URL       https://test...    https://prod  changed   │
│  REFUND_ENDPOINT   — not set —        /api/refund   missing   │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  Fix hint:                                                    │
│  clef set payments/dev REFUND_ENDPOINT <value>       [copy]   │
└───────────────────────────────────────────────────────────────┘
```

## Controls

Three dropdowns — namespace, Environment A (left, default: `dev`), and Environment B (right, default: `production`). Changing any selector immediately re-runs the diff.

## Summary strip

Monospace badges below the controls show the count of each diff status:

- **Changed** (amber) — keys present in both environments with different values
- **Missing in [env]** (red) — keys present in one environment but absent in the other
- **Identical** (green) — keys with the same value in both (hidden by default)

A checkbox labeled "Show identical" toggles visibility of identical keys.

## Diff table

The table has four columns:

| Column          | Content                                                      |
| --------------- | ------------------------------------------------------------ |
| **Key**         | The key name                                                 |
| **Env A value** | The decrypted value in environment A                         |
| **Env B value** | The decrypted value in environment B                         |
| **Status**      | Colour-coded badge: "changed", "missing in dev", "identical" |

### Row styling

- **Changed rows:** Env A value in amber text, Env B value in blue text
- **Missing rows:** The absent side shows "-- not set --" in italic red text. The status badge reads "Missing in [env]" in red.
- **Identical rows:** Normal text, green status badge. Hidden by default.

## Fix hints

When missing keys are found, a panel below the table shows the exact `clef set` command to fix each gap:

```
clef set payments/dev REFUND_ENDPOINT <value>
```

Each command has a **copy** button.

## Workflow

A typical diff workflow:

1. Open the diff view from the sidebar or from a namespace row's diff button in the matrix
2. Select the namespace and the two environments to compare
3. Review changed and missing keys
4. Copy fix commands from the hint panel
5. Run them in your terminal (or switch to the editor to fix inline)
6. Return to the diff view to confirm the gaps are closed
7. Run lint and commit

## CLI equivalent

The diff view is the visual counterpart of `clef diff`:

```bash
clef diff payments dev production
```

Both produce the same data — the CLI outputs a formatted table; the UI adds copy buttons and navigation.
