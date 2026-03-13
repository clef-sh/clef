[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ExecOptions

# Interface: ExecOptions

Defined in: [packages/core/src/types/index.ts:316](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L316)

Options for `ConsumptionClient.prepareEnvironment`.

## Properties

| Property                                       | Type       | Description                                                        | Defined in                                                                                                                                                  |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-nooverride"></a> `noOverride?` | `boolean`  | When `true`, skip keys that already exist in the base environment. | [packages/core/src/types/index.ts:322](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L322) |
| <a id="property-only"></a> `only?`             | `string`[] | Inject only these keys (if set, all other keys are excluded).      | [packages/core/src/types/index.ts:318](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L318) |
| <a id="property-prefix"></a> `prefix?`         | `string`   | Prepend this string to every injected environment variable name.   | [packages/core/src/types/index.ts:320](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L320) |
