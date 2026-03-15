[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / EnvironmentSopsOverride

# Interface: EnvironmentSopsOverride

Defined in: [packages/core/src/types/index.ts:45](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L45)

Per-environment SOPS backend override.

## Properties

| Property                                                         | Type                                           | Defined in                                                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-aws_kms_arn"></a> `aws_kms_arn?`                 | `string`                                       | [packages/core/src/types/index.ts:47](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L47) |
| <a id="property-backend"></a> `backend`                          | `"age"` \| `"awskms"` \| `"gcpkms"` \| `"pgp"` | [packages/core/src/types/index.ts:46](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L46) |
| <a id="property-gcp_kms_resource_id"></a> `gcp_kms_resource_id?` | `string`                                       | [packages/core/src/types/index.ts:48](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L48) |
| <a id="property-pgp_fingerprint"></a> `pgp_fingerprint?`         | `string`                                       | [packages/core/src/types/index.ts:49](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L49) |
