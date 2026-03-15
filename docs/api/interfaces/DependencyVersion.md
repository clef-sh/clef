[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DependencyVersion

# Interface: DependencyVersion

Defined in: [packages/core/src/types/index.ts:509](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L509)

Version check result for a single external dependency.

## Properties

| Property                                           | Type                                 | Description                                                                 | Defined in                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-installed"></a> `installed`        | `string`                             | Installed version string, e.g. `"3.9.1"`.                                   | [packages/core/src/types/index.ts:511](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L511) |
| <a id="property-installhint"></a> `installHint`    | `string`                             | Platform-appropriate install/upgrade command hint.                          | [packages/core/src/types/index.ts:517](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L517) |
| <a id="property-required"></a> `required`          | `string`                             | Minimum required version string.                                            | [packages/core/src/types/index.ts:513](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L513) |
| <a id="property-resolvedpath"></a> `resolvedPath?` | `string`                             | Resolved path to the binary.                                                | [packages/core/src/types/index.ts:521](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L521) |
| <a id="property-satisfied"></a> `satisfied`        | `boolean`                            | `true` when `installed >= required`.                                        | [packages/core/src/types/index.ts:515](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L515) |
| <a id="property-source"></a> `source?`             | `"env"` \| `"bundled"` \| `"system"` | How the binary was resolved: env override, bundled package, or system PATH. | [packages/core/src/types/index.ts:519](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L519) |
