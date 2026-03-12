[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DiffRow

# Interface: DiffRow

Defined in: [packages/core/src/types/index.ts:157](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L157)

One row in a diff result representing a single key comparison.

## Properties

| Property                              | Type                                          | Description                                               | Defined in                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-key"></a> `key`       | `string`                                      | -                                                         | [packages/core/src/types/index.ts:158](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L158) |
| <a id="property-status"></a> `status` | [`DiffStatus`](../type-aliases/DiffStatus.md) | -                                                         | [packages/core/src/types/index.ts:163](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L163) |
| <a id="property-valuea"></a> `valueA` | `string` \| `null`                            | Value from environment A, or `null` if the key is absent. | [packages/core/src/types/index.ts:160](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L160) |
| <a id="property-valueb"></a> `valueB` | `string` \| `null`                            | Value from environment B, or `null` if the key is absent. | [packages/core/src/types/index.ts:162](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L162) |
