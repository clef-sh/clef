[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / matchPatterns

# Function: matchPatterns()

```ts
function matchPatterns(line, lineNumber, filePath): ScanMatch[];
```

Defined in: [packages/core/src/scanner/patterns.ts:85](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/patterns.ts#L85)

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
