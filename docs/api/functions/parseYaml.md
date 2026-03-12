[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / parseYaml

# Function: parseYaml()

```ts
function parseYaml(content): ParsedImport;
```

Defined in: [packages/core/src/import/parsers.ts:181](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/import/parsers.ts#L181)

Parse a YAML mapping into flat string key/value pairs.
Non-string values are skipped with warnings.

## Parameters

| Parameter | Type     |
| --------- | -------- |
| `content` | `string` |

## Returns

[`ParsedImport`](../interfaces/ParsedImport.md)

## Throws

`Error` If the content is not valid YAML or the root is not a mapping.
