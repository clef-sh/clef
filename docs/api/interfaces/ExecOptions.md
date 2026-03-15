[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ExecOptions

# Interface: ExecOptions

Defined in: [packages/core/src/types/index.ts:327](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L327)

Options for `ConsumptionClient.prepareEnvironment`.

## Properties

| Property                                       | Type       | Description                                                        | Defined in                                                                                                                                                  |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-nooverride"></a> `noOverride?` | `boolean`  | When `true`, skip keys that already exist in the base environment. | [packages/core/src/types/index.ts:333](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L333) |
| <a id="property-only"></a> `only?`             | `string`[] | Inject only these keys (if set, all other keys are excluded).      | [packages/core/src/types/index.ts:329](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L329) |
| <a id="property-prefix"></a> `prefix?`         | `string`   | Prepend this string to every injected environment variable name.   | [packages/core/src/types/index.ts:331](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L331) |
