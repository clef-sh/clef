[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / GitStatus

# Interface: GitStatus

Defined in: [packages/core/src/types/index.ts:215](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L215)

Parsed output of `git status --porcelain`.

## Properties

| Property                                    | Type       | Description                              | Defined in                                                                                                                                                  |
| ------------------------------------------- | ---------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-staged"></a> `staged`       | `string`[] | Files with staged (index) changes.       | [packages/core/src/types/index.ts:217](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L217) |
| <a id="property-unstaged"></a> `unstaged`   | `string`[] | Files with unstaged (work-tree) changes. | [packages/core/src/types/index.ts:219](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L219) |
| <a id="property-untracked"></a> `untracked` | `string`[] | -                                        | [packages/core/src/types/index.ts:220](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L220) |
