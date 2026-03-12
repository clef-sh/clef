[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / shouldIgnoreFile

# Function: shouldIgnoreFile()

```ts
function shouldIgnoreFile(filePath, rules): boolean;
```

Defined in: [packages/core/src/scanner/ignore.ts:57](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/scanner/ignore.ts#L57)

Returns true if a file path should be ignored per .clefignore rules.

## Parameters

| Parameter  | Type                                                  |
| ---------- | ----------------------------------------------------- |
| `filePath` | `string`                                              |
| `rules`    | [`ClefIgnoreRules`](../interfaces/ClefIgnoreRules.md) |

## Returns

`boolean`
