[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ValidationResult

# Interface: ValidationResult

Defined in: [packages/core/src/types/index.ts:188](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L188)

Result of validating a set of decrypted values against a namespace schema.

## Properties

| Property                                  | Type                                          | Description                                             | Defined in                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-errors"></a> `errors`     | [`ValidationError`](ValidationError.md)[]     | -                                                       | [packages/core/src/types/index.ts:191](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L191) |
| <a id="property-valid"></a> `valid`       | `boolean`                                     | `true` when there are no errors (warnings are allowed). | [packages/core/src/types/index.ts:190](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L190) |
| <a id="property-warnings"></a> `warnings` | [`ValidationWarning`](ValidationWarning.md)[] | -                                                       | [packages/core/src/types/index.ts:192](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L192) |
