[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / parseIgnoreContent

# Function: parseIgnoreContent()

```ts
function parseIgnoreContent(content): ClefIgnoreRules;
```

Defined in: [packages/core/src/scanner/ignore.ts:32](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/ignore.ts#L32)

Parse raw `.clefignore` content into structured rules.
Lines starting with `ignore-pattern:` suppress named patterns; lines ending with `/`
suppress entire directory paths; all other lines are treated as file glob patterns.

## Parameters

| Parameter | Type     | Description                     |
| --------- | -------- | ------------------------------- |
| `content` | `string` | Raw `.clefignore` file content. |

## Returns

[`ClefIgnoreRules`](../interfaces/ClefIgnoreRules.md)
