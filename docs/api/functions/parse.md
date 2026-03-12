[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / parse

# Function: parse()

```ts
function parse(content, format, filePath?): ParsedImport;
```

Defined in: [packages/core/src/import/parsers.ts:233](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/import/parsers.ts#L233)

Parse content in the given format (or auto-detect) and return flat key/value pairs.

## Parameters

| Parameter   | Type                                              | Description                                                         |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| `content`   | `string`                                          | Raw file content to parse.                                          |
| `format`    | [`ImportFormat`](../type-aliases/ImportFormat.md) | Explicit format, or `"auto"` to detect from `filePath` and content. |
| `filePath?` | `string`                                          | File path used for format detection when `format` is `"auto"`.      |

## Returns

[`ParsedImport`](../interfaces/ParsedImport.md)
