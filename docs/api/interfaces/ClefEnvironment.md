[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ClefEnvironment

# Interface: ClefEnvironment

Defined in: [packages/core/src/types/index.ts:52](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L52)

A single deployment environment declared in the manifest.

## Properties

| Property                                        | Type                                                           | Description                                                                                     | Defined in                                                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-description"></a> `description` | `string`                                                       | -                                                                                               | [packages/core/src/types/index.ts:54](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L54) |
| <a id="property-name"></a> `name`               | `string`                                                       | -                                                                                               | [packages/core/src/types/index.ts:53](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L53) |
| <a id="property-protected"></a> `protected?`    | `boolean`                                                      | When `true`, write operations require explicit confirmation.                                    | [packages/core/src/types/index.ts:56](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L56) |
| <a id="property-recipients"></a> `recipients?`  | ( \| `string` \| \{ `key`: `string`; `label?`: `string`; \})[] | Per-environment age recipient overrides. When set, these recipients are used instead of global. | [packages/core/src/types/index.ts:60](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L60) |
| <a id="property-sops"></a> `sops?`              | [`EnvironmentSopsOverride`](EnvironmentSopsOverride.md)        | Per-environment SOPS backend override. Falls back to global `sops` config when absent.          | [packages/core/src/types/index.ts:58](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L58) |
