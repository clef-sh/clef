[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ScanMatch

# Interface: ScanMatch

Defined in: [packages/core/src/scanner/patterns.ts:13](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/patterns.ts#L13)

TIER 1 MODULE — Security and correctness critical.

This module requires exhaustive test coverage. Before
adding or modifying code here:

1. Add tests for the happy path
2. Add tests for all documented error paths
3. Add at least one boundary/edge case test

Coverage threshold: 95% lines/functions, 90% branches.
See docs/contributing/testing.md for the rationale.

## Properties

| Property                                         | Type                       | Defined in                                                                                                                                                          |
| ------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-column"></a> `column`            | `number`                   | [packages/core/src/scanner/patterns.ts:16](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/patterns.ts#L16) |
| <a id="property-entropy"></a> `entropy?`         | `number`                   | [packages/core/src/scanner/patterns.ts:19](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/patterns.ts#L19) |
| <a id="property-file"></a> `file`                | `string`                   | [packages/core/src/scanner/patterns.ts:14](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/patterns.ts#L14) |
| <a id="property-line"></a> `line`                | `number`                   | [packages/core/src/scanner/patterns.ts:15](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/patterns.ts#L15) |
| <a id="property-matchtype"></a> `matchType`      | `"pattern"` \| `"entropy"` | [packages/core/src/scanner/patterns.ts:17](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/patterns.ts#L17) |
| <a id="property-patternname"></a> `patternName?` | `string`                   | [packages/core/src/scanner/patterns.ts:18](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/patterns.ts#L18) |
| <a id="property-preview"></a> `preview`          | `string`                   | [packages/core/src/scanner/patterns.ts:20](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/scanner/patterns.ts#L20) |
