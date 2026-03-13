[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / GitStatus

# Interface: GitStatus

Defined in: [packages/core/src/types/index.ts:259](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L259)

Parsed output of `git status --porcelain`.

## Properties

| Property                                    | Type       | Description                              | Defined in                                                                                                                                                  |
| ------------------------------------------- | ---------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-staged"></a> `staged`       | `string`[] | Files with staged (index) changes.       | [packages/core/src/types/index.ts:261](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L261) |
| <a id="property-unstaged"></a> `unstaged`   | `string`[] | Files with unstaged (work-tree) changes. | [packages/core/src/types/index.ts:263](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L263) |
| <a id="property-untracked"></a> `untracked` | `string`[] | -                                        | [packages/core/src/types/index.ts:264](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L264) |
