[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / parseJson

# Function: parseJson()

```ts
function parseJson(content): ParsedImport;
```

Defined in: [packages/core/src/import/parsers.ts:130](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/import/parsers.ts#L130)

Parse a JSON object into flat string key/value pairs.
Non-string values (numbers, booleans, nulls, arrays, objects) are skipped with warnings.

## Parameters

| Parameter | Type     |
| --------- | -------- |
| `content` | `string` |

## Returns

[`ParsedImport`](../interfaces/ParsedImport.md)

## Throws

`Error` If the content is not valid JSON or the root is not an object.
