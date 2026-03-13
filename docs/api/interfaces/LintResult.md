[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / LintResult

# Interface: LintResult

Defined in: [packages/core/src/types/index.ts:240](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L240)

Aggregate result from a full lint run.

## Properties

| Property                                          | Type                          | Description                                                           | Defined in                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-filecount"></a> `fileCount`       | `number`                      | Total number of matrix files checked (including missing ones).        | [packages/core/src/types/index.ts:243](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L243) |
| <a id="property-issues"></a> `issues`             | [`LintIssue`](LintIssue.md)[] | -                                                                     | [packages/core/src/types/index.ts:241](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L241) |
| <a id="property-pendingcount"></a> `pendingCount` | `number`                      | Total number of keys marked as pending placeholders across all files. | [packages/core/src/types/index.ts:245](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L245) |
