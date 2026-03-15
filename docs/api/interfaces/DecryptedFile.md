[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DecryptedFile

# Interface: DecryptedFile

Defined in: [packages/core/src/types/index.ts:281](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L281)

The in-memory result of decrypting a SOPS-encrypted file. Plaintext never touches disk.

## Properties

| Property                                  | Type                              | Description                                  | Defined in                                                                                                                                                  |
| ----------------------------------------- | --------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-metadata"></a> `metadata` | [`SopsMetadata`](SopsMetadata.md) | -                                            | [packages/core/src/types/index.ts:284](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L284) |
| <a id="property-values"></a> `values`     | `Record`\<`string`, `string`\>    | Flat key/value map of all decrypted secrets. | [packages/core/src/types/index.ts:283](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L283) |
