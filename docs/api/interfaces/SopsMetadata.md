[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SopsMetadata

# Interface: SopsMetadata

Defined in: [packages/core/src/types/index.ts:288](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L288)

SOPS metadata extracted from an encrypted file without decrypting its values.

## Properties

| Property                                          | Type                                           | Description                                                                  | Defined in                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-backend"></a> `backend`           | `"age"` \| `"awskms"` \| `"gcpkms"` \| `"pgp"` | -                                                                            | [packages/core/src/types/index.ts:289](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L289) |
| <a id="property-lastmodified"></a> `lastModified` | `Date`                                         | -                                                                            | [packages/core/src/types/index.ts:292](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L292) |
| <a id="property-recipients"></a> `recipients`     | `string`[]                                     | List of recipient identifiers (age public keys, KMS ARNs, PGP fingerprints). | [packages/core/src/types/index.ts:291](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L291) |
