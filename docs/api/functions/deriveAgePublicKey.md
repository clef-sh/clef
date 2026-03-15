[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / deriveAgePublicKey

# Function: deriveAgePublicKey()

```ts
function deriveAgePublicKey(privateKey): Promise<string>;
```

Defined in: [packages/core/src/age/keygen.ts:29](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/age/keygen.ts#L29)

Derive the age public key (`age1...`) from an existing private key (`AGE-SECRET-KEY-1...`).

## Parameters

| Parameter    | Type     |
| ------------ | -------- |
| `privateKey` | `string` |

## Returns

`Promise`\<`string`\>
