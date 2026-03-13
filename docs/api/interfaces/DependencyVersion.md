[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DependencyVersion

# Interface: DependencyVersion

Defined in: [packages/core/src/types/index.ts:452](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L452)

Version check result for a single external dependency.

## Properties

| Property                                        | Type      | Description                                        | Defined in                                                                                                                                                  |
| ----------------------------------------------- | --------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-installed"></a> `installed`     | `string`  | Installed version string, e.g. `"3.9.1"`.          | [packages/core/src/types/index.ts:454](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L454) |
| <a id="property-installhint"></a> `installHint` | `string`  | Platform-appropriate install/upgrade command hint. | [packages/core/src/types/index.ts:460](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L460) |
| <a id="property-required"></a> `required`       | `string`  | Minimum required version string.                   | [packages/core/src/types/index.ts:456](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L456) |
| <a id="property-satisfied"></a> `satisfied`     | `boolean` | `true` when `installed >= required`.               | [packages/core/src/types/index.ts:458](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L458) |
