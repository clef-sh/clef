[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / LintIssue

# Interface: LintIssue

Defined in: [packages/core/src/types/index.ts:227](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L227)

A single issue reported by `LintRunner`.

## Properties

| Property                                       | Type                                              | Description                                              | Defined in                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-category"></a> `category`      | [`LintCategory`](../type-aliases/LintCategory.md) | -                                                        | [packages/core/src/types/index.ts:229](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L229) |
| <a id="property-file"></a> `file`              | `string`                                          | Path to the affected encrypted file.                     | [packages/core/src/types/index.ts:231](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L231) |
| <a id="property-fixcommand"></a> `fixCommand?` | `string`                                          | CLI command that can auto-fix this issue, if one exists. | [packages/core/src/types/index.ts:236](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L236) |
| <a id="property-key"></a> `key?`               | `string`                                          | The affected key name, if applicable.                    | [packages/core/src/types/index.ts:233](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L233) |
| <a id="property-message"></a> `message`        | `string`                                          | -                                                        | [packages/core/src/types/index.ts:234](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L234) |
| <a id="property-severity"></a> `severity`      | [`LintSeverity`](../type-aliases/LintSeverity.md) | -                                                        | [packages/core/src/types/index.ts:228](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L228) |
