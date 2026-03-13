[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SopsMetadata

# Interface: SopsMetadata

Defined in: [packages/core/src/types/index.ts:277](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L277)

SOPS metadata extracted from an encrypted file without decrypting its values.

## Properties

| Property                                          | Type                                           | Description                                                                  | Defined in                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-backend"></a> `backend`           | `"age"` \| `"awskms"` \| `"gcpkms"` \| `"pgp"` | -                                                                            | [packages/core/src/types/index.ts:278](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L278) |
| <a id="property-lastmodified"></a> `lastModified` | `Date`                                         | -                                                                            | [packages/core/src/types/index.ts:281](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L281) |
| <a id="property-recipients"></a> `recipients`     | `string`[]                                     | List of recipient identifiers (age public keys, KMS ARNs, PGP fingerprints). | [packages/core/src/types/index.ts:280](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L280) |
