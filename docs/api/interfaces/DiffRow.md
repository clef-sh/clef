[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DiffRow

# Interface: DiffRow

Defined in: [packages/core/src/types/index.ts:212](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L212)

One row in a diff result representing a single key comparison.

## Properties

| Property                              | Type                                          | Description                                               | Defined in                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-key"></a> `key`       | `string`                                      | -                                                         | [packages/core/src/types/index.ts:213](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L213) |
| <a id="property-status"></a> `status` | [`DiffStatus`](../type-aliases/DiffStatus.md) | -                                                         | [packages/core/src/types/index.ts:218](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L218) |
| <a id="property-valuea"></a> `valueA` | `string` \| `null`                            | Value from environment A, or `null` if the key is absent. | [packages/core/src/types/index.ts:215](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L215) |
| <a id="property-valueb"></a> `valueB` | `string` \| `null`                            | Value from environment B, or `null` if the key is absent. | [packages/core/src/types/index.ts:217](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L217) |
