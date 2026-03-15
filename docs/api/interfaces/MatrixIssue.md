[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / MatrixIssue

# Interface: MatrixIssue

Defined in: [packages/core/src/types/index.ts:146](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L146)

An issue detected within a single matrix cell.

## Properties

| Property                                | Type                                                     | Description                           | Defined in                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-key"></a> `key?`        | `string`                                                 | The affected key name, if applicable. | [packages/core/src/types/index.ts:150](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L150) |
| <a id="property-message"></a> `message` | `string`                                                 | -                                     | [packages/core/src/types/index.ts:148](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L148) |
| <a id="property-type"></a> `type`       | `"missing_keys"` \| `"schema_warning"` \| `"sops_error"` | -                                     | [packages/core/src/types/index.ts:147](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L147) |
