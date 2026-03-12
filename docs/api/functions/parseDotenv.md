[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / parseDotenv

# Function: parseDotenv()

```ts
function parseDotenv(content): ParsedImport;
```

Defined in: [packages/core/src/import/parsers.ts:72](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/import/parsers.ts#L72)

Parse dotenv-formatted content into flat key/value pairs.
Supports `export KEY=VALUE`, inline comments, and both single- and double-quoted values.

## Parameters

| Parameter | Type     |
| --------- | -------- |
| `content` | `string` |

## Returns

[`ParsedImport`](../interfaces/ParsedImport.md)
