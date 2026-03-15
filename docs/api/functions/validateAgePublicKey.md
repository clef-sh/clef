[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / validateAgePublicKey

# Function: validateAgePublicKey()

```ts
function validateAgePublicKey(input): AgeKeyValidation;
```

Defined in: [packages/core/src/recipients/validator.ts:17](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/recipients/validator.ts#L17)

Validate that a string is a well-formed age public key (bech32, `age1` prefix).

## Parameters

| Parameter | Type     | Description             |
| --------- | -------- | ----------------------- |
| `input`   | `string` | The string to validate. |

## Returns

[`AgeKeyValidation`](../interfaces/AgeKeyValidation.md)

`{ valid: true, key: trimmedKey }` or `{ valid: false, error: message }`.
