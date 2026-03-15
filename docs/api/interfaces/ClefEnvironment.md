[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ClefEnvironment

# Interface: ClefEnvironment

Defined in: [packages/core/src/types/index.ts:53](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L53)

A single deployment environment declared in the manifest.

## Properties

| Property                                        | Type                                                           | Description                                                                                     | Defined in                                                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-description"></a> `description` | `string`                                                       | -                                                                                               | [packages/core/src/types/index.ts:55](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L55) |
| <a id="property-name"></a> `name`               | `string`                                                       | -                                                                                               | [packages/core/src/types/index.ts:54](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L54) |
| <a id="property-protected"></a> `protected?`    | `boolean`                                                      | When `true`, write operations require explicit confirmation.                                    | [packages/core/src/types/index.ts:57](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L57) |
| <a id="property-recipients"></a> `recipients?`  | ( \| `string` \| \{ `key`: `string`; `label?`: `string`; \})[] | Per-environment age recipient overrides. When set, these recipients are used instead of global. | [packages/core/src/types/index.ts:61](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L61) |
| <a id="property-sops"></a> `sops?`              | [`EnvironmentSopsOverride`](EnvironmentSopsOverride.md)        | Per-environment SOPS backend override. Falls back to global `sops` config when absent.          | [packages/core/src/types/index.ts:59](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L59) |
