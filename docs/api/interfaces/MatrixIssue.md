[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / MatrixIssue

# Interface: MatrixIssue

Defined in: [packages/core/src/types/index.ts:135](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L135)

An issue detected within a single matrix cell.

## Properties

| Property                                | Type                                                     | Description                           | Defined in                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-key"></a> `key?`        | `string`                                                 | The affected key name, if applicable. | [packages/core/src/types/index.ts:139](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L139) |
| <a id="property-message"></a> `message` | `string`                                                 | -                                     | [packages/core/src/types/index.ts:137](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L137) |
| <a id="property-type"></a> `type`       | `"missing_keys"` \| `"schema_warning"` \| `"sops_error"` | -                                     | [packages/core/src/types/index.ts:136](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L136) |
