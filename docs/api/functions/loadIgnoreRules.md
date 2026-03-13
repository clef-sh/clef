[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / loadIgnoreRules

# Function: loadIgnoreRules()

```ts
function loadIgnoreRules(repoRoot): ClefIgnoreRules;
```

Defined in: [packages/core/src/scanner/ignore.ts:15](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/scanner/ignore.ts#L15)

Load .clefignore rules from the repo root.
Returns empty rules if the file does not exist.

## Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `repoRoot` | `string` |

## Returns

[`ClefIgnoreRules`](../interfaces/ClefIgnoreRules.md)
