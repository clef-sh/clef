[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / EnvironmentSopsOverride

# Interface: EnvironmentSopsOverride

Defined in: [packages/core/src/types/index.ts:44](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L44)

Per-environment SOPS backend override.

## Properties

| Property                                                         | Type                                           | Defined in                                                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-aws_kms_arn"></a> `aws_kms_arn?`                 | `string`                                       | [packages/core/src/types/index.ts:46](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L46) |
| <a id="property-backend"></a> `backend`                          | `"age"` \| `"awskms"` \| `"gcpkms"` \| `"pgp"` | [packages/core/src/types/index.ts:45](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L45) |
| <a id="property-gcp_kms_resource_id"></a> `gcp_kms_resource_id?` | `string`                                       | [packages/core/src/types/index.ts:47](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L47) |
| <a id="property-pgp_fingerprint"></a> `pgp_fingerprint?`         | `string`                                       | [packages/core/src/types/index.ts:48](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L48) |
