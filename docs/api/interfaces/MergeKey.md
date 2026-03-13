[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / MergeKey

# Interface: MergeKey

Defined in: [packages/core/src/merge/driver.ts:7](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L7)

One key's resolution in the three-way merge.

## Properties

| Property                                        | Type                                                  | Description                                                                                   | Defined in                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-basevalue"></a> `baseValue`     | `string` \| `null`                                    | Base value (common ancestor). `null` if the key did not exist in base.                        | [packages/core/src/merge/driver.ts:13](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L13) |
| <a id="property-key"></a> `key`                 | `string`                                              | -                                                                                             | [packages/core/src/merge/driver.ts:8](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L8)   |
| <a id="property-oursvalue"></a> `oursValue`     | `string` \| `null`                                    | Value from ours. `null` if the key was deleted or absent in ours.                             | [packages/core/src/merge/driver.ts:15](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L15) |
| <a id="property-status"></a> `status`           | [`MergeKeyStatus`](../type-aliases/MergeKeyStatus.md) | -                                                                                             | [packages/core/src/merge/driver.ts:9](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L9)   |
| <a id="property-theirsvalue"></a> `theirsValue` | `string` \| `null`                                    | Value from theirs. `null` if the key was deleted or absent in theirs.                         | [packages/core/src/merge/driver.ts:17](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L17) |
| <a id="property-value"></a> `value`             | `string` \| `null`                                    | Resolved value when status is not "conflict". `null` for deletions or unresolvable conflicts. | [packages/core/src/merge/driver.ts:11](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L11) |
