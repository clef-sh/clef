[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / LintResult

# Interface: LintResult

Defined in: [packages/core/src/types/index.ts:196](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L196)

Aggregate result from a full lint run.

## Properties

| Property                                          | Type                          | Description                                                           | Defined in                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-filecount"></a> `fileCount`       | `number`                      | Total number of matrix files checked (including missing ones).        | [packages/core/src/types/index.ts:199](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L199) |
| <a id="property-issues"></a> `issues`             | [`LintIssue`](LintIssue.md)[] | -                                                                     | [packages/core/src/types/index.ts:197](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L197) |
| <a id="property-pendingcount"></a> `pendingCount` | `number`                      | Total number of keys marked as pending placeholders across all files. | [packages/core/src/types/index.ts:201](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L201) |
