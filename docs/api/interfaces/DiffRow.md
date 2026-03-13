[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DiffRow

# Interface: DiffRow

Defined in: [packages/core/src/types/index.ts:201](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L201)

One row in a diff result representing a single key comparison.

## Properties

| Property                              | Type                                          | Description                                               | Defined in                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-key"></a> `key`       | `string`                                      | -                                                         | [packages/core/src/types/index.ts:202](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L202) |
| <a id="property-status"></a> `status` | [`DiffStatus`](../type-aliases/DiffStatus.md) | -                                                         | [packages/core/src/types/index.ts:207](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L207) |
| <a id="property-valuea"></a> `valueA` | `string` \| `null`                            | Value from environment A, or `null` if the key is absent. | [packages/core/src/types/index.ts:204](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L204) |
| <a id="property-valueb"></a> `valueB` | `string` \| `null`                            | Value from environment B, or `null` if the key is absent. | [packages/core/src/types/index.ts:206](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L206) |
