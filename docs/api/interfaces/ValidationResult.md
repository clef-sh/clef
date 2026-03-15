[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ValidationResult

# Interface: ValidationResult

Defined in: [packages/core/src/types/index.ts:199](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L199)

Result of validating a set of decrypted values against a namespace schema.

## Properties

| Property                                  | Type                                          | Description                                             | Defined in                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-errors"></a> `errors`     | [`ValidationError`](ValidationError.md)[]     | -                                                       | [packages/core/src/types/index.ts:202](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L202) |
| <a id="property-valid"></a> `valid`       | `boolean`                                     | `true` when there are no errors (warnings are allowed). | [packages/core/src/types/index.ts:201](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L201) |
| <a id="property-warnings"></a> `warnings` | [`ValidationWarning`](ValidationWarning.md)[] | -                                                       | [packages/core/src/types/index.ts:203](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L203) |
