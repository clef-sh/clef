[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DependencyVersion

# Interface: DependencyVersion

Defined in: [packages/core/src/types/index.ts:379](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L379)

Version check result for a single external dependency.

## Properties

| Property                                        | Type      | Description                                        | Defined in                                                                                                                                                  |
| ----------------------------------------------- | --------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-installed"></a> `installed`     | `string`  | Installed version string, e.g. `"3.9.1"`.          | [packages/core/src/types/index.ts:381](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L381) |
| <a id="property-installhint"></a> `installHint` | `string`  | Platform-appropriate install/upgrade command hint. | [packages/core/src/types/index.ts:387](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L387) |
| <a id="property-required"></a> `required`       | `string`  | Minimum required version string.                   | [packages/core/src/types/index.ts:383](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L383) |
| <a id="property-satisfied"></a> `satisfied`     | `boolean` | `true` when `installed >= required`.               | [packages/core/src/types/index.ts:385](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L385) |
