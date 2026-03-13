[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / MatrixStatus

# Interface: MatrixStatus

Defined in: [packages/core/src/types/index.ts:143](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L143)

Decrypted status summary for one matrix cell.

## Properties

| Property                                          | Type                              | Description                                              | Defined in                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-cell"></a> `cell`                 | [`MatrixCell`](MatrixCell.md)     | -                                                        | [packages/core/src/types/index.ts:144](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L144) |
| <a id="property-issues"></a> `issues`             | [`MatrixIssue`](MatrixIssue.md)[] | -                                                        | [packages/core/src/types/index.ts:151](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L151) |
| <a id="property-keycount"></a> `keyCount`         | `number`                          | Number of keys in the decrypted file.                    | [packages/core/src/types/index.ts:146](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L146) |
| <a id="property-lastmodified"></a> `lastModified` | `Date` \| `null`                  | Timestamp from SOPS metadata, or `null` if unavailable.  | [packages/core/src/types/index.ts:150](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L150) |
| <a id="property-pendingcount"></a> `pendingCount` | `number`                          | Number of keys currently marked as pending placeholders. | [packages/core/src/types/index.ts:148](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L148) |
