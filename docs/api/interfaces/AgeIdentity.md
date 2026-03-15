[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / AgeIdentity

# Interface: AgeIdentity

Defined in: [packages/core/src/age/keygen.ts:6](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/age/keygen.ts#L6)

age key generation using the age-encryption npm package.
Dynamic import() is required: age-encryption is ESM-only; this package compiles to CJS.

## Properties

| Property                                      | Type     | Description                                    | Defined in                                                                                                                                              |
| --------------------------------------------- | -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-privatekey"></a> `privateKey` | `string` | AGE-SECRET-KEY-1... armored private key string | [packages/core/src/age/keygen.ts:8](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/age/keygen.ts#L8)   |
| <a id="property-publickey"></a> `publicKey`   | `string` | age1... bech32 public key string               | [packages/core/src/age/keygen.ts:10](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/age/keygen.ts#L10) |
