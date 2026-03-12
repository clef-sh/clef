[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / redactValue

# Function: redactValue()

```ts
function redactValue(value): string;
```

Defined in: [packages/core/src/scanner/patterns.ts:76](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/scanner/patterns.ts#L76)

Redact a matched secret value — show first 4 characters, mask the rest.
Never exposes more than 4 characters of any secret.

## Parameters

| Parameter | Type     |
| --------- | -------- |
| `value`   | `string` |

## Returns

`string`
