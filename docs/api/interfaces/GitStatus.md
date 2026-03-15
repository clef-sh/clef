[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / GitStatus

# Interface: GitStatus

Defined in: [packages/core/src/types/index.ts:270](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L270)

Parsed output of `git status --porcelain`.

## Properties

| Property                                    | Type       | Description                              | Defined in                                                                                                                                                  |
| ------------------------------------------- | ---------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-staged"></a> `staged`       | `string`[] | Files with staged (index) changes.       | [packages/core/src/types/index.ts:272](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L272) |
| <a id="property-unstaged"></a> `unstaged`   | `string`[] | Files with unstaged (work-tree) changes. | [packages/core/src/types/index.ts:274](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L274) |
| <a id="property-untracked"></a> `untracked` | `string`[] | -                                        | [packages/core/src/types/index.ts:275](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L275) |
