[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / parse

# Function: parse()

```ts
function parse(content, format, filePath?): ParsedImport;
```

Defined in: [packages/core/src/import/parsers.ts:233](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/import/parsers.ts#L233)

Parse content in the given format (or auto-detect) and return flat key/value pairs.

## Parameters

| Parameter   | Type                                              | Description                                                         |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| `content`   | `string`                                          | Raw file content to parse.                                          |
| `format`    | [`ImportFormat`](../type-aliases/ImportFormat.md) | Explicit format, or `"auto"` to detect from `filePath` and content. |
| `filePath?` | `string`                                          | File path used for format detection when `format` is `"auto"`.      |

## Returns

[`ParsedImport`](../interfaces/ParsedImport.md)
