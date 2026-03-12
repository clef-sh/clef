[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / loadIgnoreRules

# Function: loadIgnoreRules()

```ts
function loadIgnoreRules(repoRoot): ClefIgnoreRules;
```

Defined in: [packages/core/src/scanner/ignore.ts:15](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/scanner/ignore.ts#L15)

Load .clefignore rules from the repo root.
Returns empty rules if the file does not exist.

## Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `repoRoot` | `string` |

## Returns

[`ClefIgnoreRules`](../interfaces/ClefIgnoreRules.md)
