[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DecryptedFile

# Interface: DecryptedFile

Defined in: [packages/core/src/types/index.ts:270](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L270)

The in-memory result of decrypting a SOPS-encrypted file. Plaintext never touches disk.

## Properties

| Property                                  | Type                              | Description                                  | Defined in                                                                                                                                                  |
| ----------------------------------------- | --------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-metadata"></a> `metadata` | [`SopsMetadata`](SopsMetadata.md) | -                                            | [packages/core/src/types/index.ts:273](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L273) |
| <a id="property-values"></a> `values`     | `Record`\<`string`, `string`\>    | Flat key/value map of all decrypted secrets. | [packages/core/src/types/index.ts:272](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L272) |
