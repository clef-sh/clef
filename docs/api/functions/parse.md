[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / parse

# Function: parse()

```ts
function parse(content, format, filePath?): ParsedImport;
```

Defined in: [packages/core/src/import/parsers.ts:233](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/import/parsers.ts#L233)

Parse content in the given format (or auto-detect) and return flat key/value pairs.

## Parameters

| Parameter   | Type                                              | Description                                                         |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| `content`   | `string`                                          | Raw file content to parse.                                          |
| `format`    | [`ImportFormat`](../type-aliases/ImportFormat.md) | Explicit format, or `"auto"` to detect from `filePath` and content. |
| `filePath?` | `string`                                          | File path used for format detection when `format` is `"auto"`.      |

## Returns

[`ParsedImport`](../interfaces/ParsedImport.md)
