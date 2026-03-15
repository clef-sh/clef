[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / detectFormat

# Function: detectFormat()

```ts
function detectFormat(filePath, content): "yaml" | "json" | "dotenv";
```

Defined in: [packages/core/src/import/parsers.ts:20](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/import/parsers.ts#L20)

Auto-detect the format of a file from its extension, basename, and content heuristics.

## Parameters

| Parameter  | Type     | Description                                          |
| ---------- | -------- | ---------------------------------------------------- |
| `filePath` | `string` | File path used for extension and basename detection. |
| `content`  | `string` | Raw file content used as a fallback heuristic.       |

## Returns

`"yaml"` \| `"json"` \| `"dotenv"`

Detected format (`"dotenv"`, `"json"`, or `"yaml"`).
