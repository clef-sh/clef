[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / MergeResult

# Interface: MergeResult

Defined in: [packages/core/src/merge/driver.ts:21](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L21)

Result of a three-way merge.

## Properties

| Property                                    | Type                           | Description                                                         | Defined in                                                                                                                                                  |
| ------------------------------------------- | ------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-clean"></a> `clean`         | `boolean`                      | `true` when all keys merged cleanly with no conflicts.              | [packages/core/src/merge/driver.ts:23](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L23) |
| <a id="property-conflicts"></a> `conflicts` | [`MergeKey`](MergeKey.md)[]    | Keys that could not be auto-resolved. Empty when `clean` is `true`. | [packages/core/src/merge/driver.ts:29](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L29) |
| <a id="property-keys"></a> `keys`           | [`MergeKey`](MergeKey.md)[]    | Per-key resolution details.                                         | [packages/core/src/merge/driver.ts:27](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L27) |
| <a id="property-merged"></a> `merged`       | `Record`\<`string`, `string`\> | The merged key/value map. Only complete when `clean` is `true`.     | [packages/core/src/merge/driver.ts:25](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L25) |
