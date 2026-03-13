[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / validateAgePublicKey

# Function: validateAgePublicKey()

```ts
function validateAgePublicKey(input): AgeKeyValidation;
```

Defined in: [packages/core/src/recipients/validator.ts:17](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/recipients/validator.ts#L17)

Validate that a string is a well-formed age public key (bech32, `age1` prefix).

## Parameters

| Parameter | Type     | Description             |
| --------- | -------- | ----------------------- |
| `input`   | `string` | The string to validate. |

## Returns

[`AgeKeyValidation`](../interfaces/AgeKeyValidation.md)

`{ valid: true, key: trimmedKey }` or `{ valid: false, error: message }`.
