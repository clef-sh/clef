[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / MatrixStatus

# Interface: MatrixStatus

Defined in: [packages/core/src/types/index.ts:154](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L154)

Decrypted status summary for one matrix cell.

## Properties

| Property                                          | Type                              | Description                                              | Defined in                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-cell"></a> `cell`                 | [`MatrixCell`](MatrixCell.md)     | -                                                        | [packages/core/src/types/index.ts:155](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L155) |
| <a id="property-issues"></a> `issues`             | [`MatrixIssue`](MatrixIssue.md)[] | -                                                        | [packages/core/src/types/index.ts:162](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L162) |
| <a id="property-keycount"></a> `keyCount`         | `number`                          | Number of keys in the decrypted file.                    | [packages/core/src/types/index.ts:157](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L157) |
| <a id="property-lastmodified"></a> `lastModified` | `Date` \| `null`                  | Timestamp from SOPS metadata, or `null` if unavailable.  | [packages/core/src/types/index.ts:161](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L161) |
| <a id="property-pendingcount"></a> `pendingCount` | `number`                          | Number of keys currently marked as pending placeholders. | [packages/core/src/types/index.ts:159](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L159) |
