[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / generateAgeIdentity

# Function: generateAgeIdentity()

```ts
function generateAgeIdentity(): Promise<AgeIdentity>;
```

Defined in: [packages/core/src/age/keygen.ts:18](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/age/keygen.ts#L18)

Generate a new age key pair using the `age-encryption` npm package.

## Returns

`Promise`\<[`AgeIdentity`](../interfaces/AgeIdentity.md)\>

Private key (`AGE-SECRET-KEY-1...` format) and derived public key (`age1...` bech32 format).
