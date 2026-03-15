[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / shouldIgnoreFile

# Function: shouldIgnoreFile()

```ts
function shouldIgnoreFile(filePath, rules): boolean;
```

Defined in: [packages/core/src/scanner/ignore.ts:57](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/ignore.ts#L57)

Returns true if a file path should be ignored per .clefignore rules.

## Parameters

| Parameter  | Type                                                  |
| ---------- | ----------------------------------------------------- |
| `filePath` | `string`                                              |
| `rules`    | [`ClefIgnoreRules`](../interfaces/ClefIgnoreRules.md) |

## Returns

`boolean`
