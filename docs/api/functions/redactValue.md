[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / redactValue

# Function: redactValue()

```ts
function redactValue(value): string;
```

Defined in: [packages/core/src/scanner/patterns.ts:76](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/scanner/patterns.ts#L76)

Redact a matched secret value — show first 4 characters, mask the rest.
Never exposes more than 4 characters of any secret.

## Parameters

| Parameter | Type     |
| --------- | -------- |
| `value`   | `string` |

## Returns

`string`
