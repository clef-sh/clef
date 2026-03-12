[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / MatrixStatus

# Interface: MatrixStatus

Defined in: [packages/core/src/types/index.ts:99](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L99)

Decrypted status summary for one matrix cell.

## Properties

| Property                                          | Type                              | Description                                              | Defined in                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-cell"></a> `cell`                 | [`MatrixCell`](MatrixCell.md)     | -                                                        | [packages/core/src/types/index.ts:100](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L100) |
| <a id="property-issues"></a> `issues`             | [`MatrixIssue`](MatrixIssue.md)[] | -                                                        | [packages/core/src/types/index.ts:107](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L107) |
| <a id="property-keycount"></a> `keyCount`         | `number`                          | Number of keys in the decrypted file.                    | [packages/core/src/types/index.ts:102](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L102) |
| <a id="property-lastmodified"></a> `lastModified` | `Date` \| `null`                  | Timestamp from SOPS metadata, or `null` if unavailable.  | [packages/core/src/types/index.ts:106](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L106) |
| <a id="property-pendingcount"></a> `pendingCount` | `number`                          | Number of keys currently marked as pending placeholders. | [packages/core/src/types/index.ts:104](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L104) |
