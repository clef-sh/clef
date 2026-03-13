[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SopsConfig

# Interface: SopsConfig

Defined in: [packages/core/src/types/index.ts:106](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L106)

SOPS encryption backend configuration from the manifest.

## Properties

| Property                                                         | Type                                           | Defined in                                                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-aws_kms_arn"></a> `aws_kms_arn?`                 | `string`                                       | [packages/core/src/types/index.ts:108](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L108) |
| <a id="property-default_backend"></a> `default_backend`          | `"age"` \| `"awskms"` \| `"gcpkms"` \| `"pgp"` | [packages/core/src/types/index.ts:107](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L107) |
| <a id="property-gcp_kms_resource_id"></a> `gcp_kms_resource_id?` | `string`                                       | [packages/core/src/types/index.ts:109](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L109) |
| <a id="property-pgp_fingerprint"></a> `pgp_fingerprint?`         | `string`                                       | [packages/core/src/types/index.ts:110](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L110) |
