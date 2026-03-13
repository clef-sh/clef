[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / parseIgnoreContent

# Function: parseIgnoreContent()

```ts
function parseIgnoreContent(content): ClefIgnoreRules;
```

Defined in: [packages/core/src/scanner/ignore.ts:32](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/scanner/ignore.ts#L32)

Parse raw `.clefignore` content into structured rules.
Lines starting with `ignore-pattern:` suppress named patterns; lines ending with `/`
suppress entire directory paths; all other lines are treated as file glob patterns.

## Parameters

| Parameter | Type     | Description                     |
| --------- | -------- | ------------------------------- |
| `content` | `string` | Raw `.clefignore` file content. |

## Returns

[`ClefIgnoreRules`](../interfaces/ClefIgnoreRules.md)
