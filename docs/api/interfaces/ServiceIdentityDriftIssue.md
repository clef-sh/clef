[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ServiceIdentityDriftIssue

# Interface: ServiceIdentityDriftIssue

Defined in: [packages/core/src/types/index.ts:492](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L492)

A drift issue detected in a service identity configuration.

## Properties

| Property                                         | Type                                                                                                                                  | Defined in                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-environment"></a> `environment?` | `string`                                                                                                                              | [packages/core/src/types/index.ts:494](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L494) |
| <a id="property-fixcommand"></a> `fixCommand?`   | `string`                                                                                                                              | [packages/core/src/types/index.ts:503](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L503) |
| <a id="property-identity"></a> `identity`        | `string`                                                                                                                              | [packages/core/src/types/index.ts:493](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L493) |
| <a id="property-message"></a> `message`          | `string`                                                                                                                              | [packages/core/src/types/index.ts:502](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L502) |
| <a id="property-namespace"></a> `namespace?`     | `string`                                                                                                                              | [packages/core/src/types/index.ts:495](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L495) |
| <a id="property-type"></a> `type`                | \| `"missing_environment"` \| `"scope_mismatch"` \| `"recipient_not_registered"` \| `"orphaned_recipient"` \| `"namespace_not_found"` | [packages/core/src/types/index.ts:496](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L496) |
