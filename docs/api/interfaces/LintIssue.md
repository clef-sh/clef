[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / LintIssue

# Interface: LintIssue

Defined in: [packages/core/src/types/index.ts:183](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L183)

A single issue reported by `LintRunner`.

## Properties

| Property                                       | Type                                              | Description                                              | Defined in                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-category"></a> `category`      | [`LintCategory`](../type-aliases/LintCategory.md) | -                                                        | [packages/core/src/types/index.ts:185](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L185) |
| <a id="property-file"></a> `file`              | `string`                                          | Path to the affected encrypted file.                     | [packages/core/src/types/index.ts:187](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L187) |
| <a id="property-fixcommand"></a> `fixCommand?` | `string`                                          | CLI command that can auto-fix this issue, if one exists. | [packages/core/src/types/index.ts:192](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L192) |
| <a id="property-key"></a> `key?`               | `string`                                          | The affected key name, if applicable.                    | [packages/core/src/types/index.ts:189](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L189) |
| <a id="property-message"></a> `message`        | `string`                                          | -                                                        | [packages/core/src/types/index.ts:190](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L190) |
| <a id="property-severity"></a> `severity`      | [`LintSeverity`](../type-aliases/LintSeverity.md) | -                                                        | [packages/core/src/types/index.ts:184](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L184) |
