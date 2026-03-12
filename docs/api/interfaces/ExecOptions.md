[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ExecOptions

# Interface: ExecOptions

Defined in: [packages/core/src/types/index.ts:243](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L243)

Options for `ConsumptionClient.prepareEnvironment`.

## Properties

| Property                                       | Type       | Description                                                        | Defined in                                                                                                                                                  |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-nooverride"></a> `noOverride?` | `boolean`  | When `true`, skip keys that already exist in the base environment. | [packages/core/src/types/index.ts:249](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L249) |
| <a id="property-only"></a> `only?`             | `string`[] | Inject only these keys (if set, all other keys are excluded).      | [packages/core/src/types/index.ts:245](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L245) |
| <a id="property-prefix"></a> `prefix?`         | `string`   | Prepend this string to every injected environment variable name.   | [packages/core/src/types/index.ts:247](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L247) |
