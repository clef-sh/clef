[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ValidationResult

# Interface: ValidationResult

Defined in: [packages/core/src/types/index.ts:144](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L144)

Result of validating a set of decrypted values against a namespace schema.

## Properties

| Property                                  | Type                                          | Description                                             | Defined in                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-errors"></a> `errors`     | [`ValidationError`](ValidationError.md)[]     | -                                                       | [packages/core/src/types/index.ts:147](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L147) |
| <a id="property-valid"></a> `valid`       | `boolean`                                     | `true` when there are no errors (warnings are allowed). | [packages/core/src/types/index.ts:146](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L146) |
| <a id="property-warnings"></a> `warnings` | [`ValidationWarning`](ValidationWarning.md)[] | -                                                       | [packages/core/src/types/index.ts:148](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L148) |
