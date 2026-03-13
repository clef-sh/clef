[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / shouldIgnoreMatch

# Function: shouldIgnoreMatch()

```ts
function shouldIgnoreMatch(match, rules): boolean;
```

Defined in: [packages/core/src/scanner/ignore.ts:75](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/scanner/ignore.ts#L75)

Returns true if a scan match should be suppressed per .clefignore rules.

## Parameters

| Parameter | Type                                                  |
| --------- | ----------------------------------------------------- |
| `match`   | [`ScanMatch`](../interfaces/ScanMatch.md)             |
| `rules`   | [`ClefIgnoreRules`](../interfaces/ClefIgnoreRules.md) |

## Returns

`boolean`
