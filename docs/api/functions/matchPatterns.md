[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / matchPatterns

# Function: matchPatterns()

```ts
function matchPatterns(line, lineNumber, filePath): ScanMatch[];
```

Defined in: [packages/core/src/scanner/patterns.ts:85](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/scanner/patterns.ts#L85)

Match a line against all known secret patterns.
Returns one ScanMatch per matched pattern.

## Parameters

| Parameter    | Type     |
| ------------ | -------- |
| `line`       | `string` |
| `lineNumber` | `number` |
| `filePath`   | `string` |

## Returns

[`ScanMatch`](../interfaces/ScanMatch.md)[]
