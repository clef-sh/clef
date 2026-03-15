[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / LintResult

# Interface: LintResult

Defined in: [packages/core/src/types/index.ts:251](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L251)

Aggregate result from a full lint run.

## Properties

| Property                                          | Type                          | Description                                                           | Defined in                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-filecount"></a> `fileCount`       | `number`                      | Total number of matrix files checked (including missing ones).        | [packages/core/src/types/index.ts:254](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L254) |
| <a id="property-issues"></a> `issues`             | [`LintIssue`](LintIssue.md)[] | -                                                                     | [packages/core/src/types/index.ts:252](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L252) |
| <a id="property-pendingcount"></a> `pendingCount` | `number`                      | Total number of keys marked as pending placeholders across all files. | [packages/core/src/types/index.ts:256](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L256) |
