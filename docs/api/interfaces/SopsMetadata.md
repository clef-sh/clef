[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SopsMetadata

# Interface: SopsMetadata

Defined in: [packages/core/src/types/index.ts:233](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L233)

SOPS metadata extracted from an encrypted file without decrypting its values.

## Properties

| Property                                          | Type                                           | Description                                                                  | Defined in                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-backend"></a> `backend`           | `"age"` \| `"awskms"` \| `"gcpkms"` \| `"pgp"` | -                                                                            | [packages/core/src/types/index.ts:234](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L234) |
| <a id="property-lastmodified"></a> `lastModified` | `Date`                                         | -                                                                            | [packages/core/src/types/index.ts:237](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L237) |
| <a id="property-recipients"></a> `recipients`     | `string`[]                                     | List of recipient identifiers (age public keys, KMS ARNs, PGP fingerprints). | [packages/core/src/types/index.ts:236](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L236) |
