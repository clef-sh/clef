[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / parseIgnoreContent

# Function: parseIgnoreContent()

```ts
function parseIgnoreContent(content): ClefIgnoreRules;
```

Defined in: [packages/core/src/scanner/ignore.ts:32](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/scanner/ignore.ts#L32)

Parse raw `.clefignore` content into structured rules.
Lines starting with `ignore-pattern:` suppress named patterns; lines ending with `/`
suppress entire directory paths; all other lines are treated as file glob patterns.

## Parameters

| Parameter | Type     | Description                     |
| --------- | -------- | ------------------------------- |
| `content` | `string` | Raw `.clefignore` file content. |

## Returns

[`ClefIgnoreRules`](../interfaces/ClefIgnoreRules.md)
