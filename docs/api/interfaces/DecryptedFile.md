[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DecryptedFile

# Interface: DecryptedFile

Defined in: [packages/core/src/types/index.ts:226](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L226)

The in-memory result of decrypting a SOPS-encrypted file. Plaintext never touches disk.

## Properties

| Property                                  | Type                              | Description                                  | Defined in                                                                                                                                                  |
| ----------------------------------------- | --------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-metadata"></a> `metadata` | [`SopsMetadata`](SopsMetadata.md) | -                                            | [packages/core/src/types/index.ts:229](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L229) |
| <a id="property-values"></a> `values`     | `Record`\<`string`, `string`\>    | Flat key/value map of all decrypted secrets. | [packages/core/src/types/index.ts:228](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L228) |
