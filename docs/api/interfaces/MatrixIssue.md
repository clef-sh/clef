[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / MatrixIssue

# Interface: MatrixIssue

Defined in: [packages/core/src/types/index.ts:91](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L91)

An issue detected within a single matrix cell.

## Properties

| Property                                | Type                                                     | Description                           | Defined in                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-key"></a> `key?`        | `string`                                                 | The affected key name, if applicable. | [packages/core/src/types/index.ts:95](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L95) |
| <a id="property-message"></a> `message` | `string`                                                 | -                                     | [packages/core/src/types/index.ts:93](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L93) |
| <a id="property-type"></a> `type`       | `"missing_keys"` \| `"schema_warning"` \| `"sops_error"` | -                                     | [packages/core/src/types/index.ts:92](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L92) |
