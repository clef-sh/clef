[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / LintIssue

# Interface: LintIssue

Defined in: [packages/core/src/types/index.ts:238](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L238)

A single issue reported by `LintRunner`.

## Properties

| Property                                       | Type                                              | Description                                              | Defined in                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-category"></a> `category`      | [`LintCategory`](../type-aliases/LintCategory.md) | -                                                        | [packages/core/src/types/index.ts:240](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L240) |
| <a id="property-file"></a> `file`              | `string`                                          | Path to the affected encrypted file.                     | [packages/core/src/types/index.ts:242](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L242) |
| <a id="property-fixcommand"></a> `fixCommand?` | `string`                                          | CLI command that can auto-fix this issue, if one exists. | [packages/core/src/types/index.ts:247](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L247) |
| <a id="property-key"></a> `key?`               | `string`                                          | The affected key name, if applicable.                    | [packages/core/src/types/index.ts:244](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L244) |
| <a id="property-message"></a> `message`        | `string`                                          | -                                                        | [packages/core/src/types/index.ts:245](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L245) |
| <a id="property-severity"></a> `severity`      | [`LintSeverity`](../type-aliases/LintSeverity.md) | -                                                        | [packages/core/src/types/index.ts:239](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L239) |
