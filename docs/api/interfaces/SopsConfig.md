[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SopsConfig

# Interface: SopsConfig

Defined in: [packages/core/src/types/index.ts:62](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L62)

SOPS encryption backend configuration from the manifest.

## Properties

| Property                                                         | Type                                           | Defined in                                                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-aws_kms_arn"></a> `aws_kms_arn?`                 | `string`                                       | [packages/core/src/types/index.ts:64](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L64) |
| <a id="property-default_backend"></a> `default_backend`          | `"age"` \| `"awskms"` \| `"gcpkms"` \| `"pgp"` | [packages/core/src/types/index.ts:63](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L63) |
| <a id="property-gcp_kms_resource_id"></a> `gcp_kms_resource_id?` | `string`                                       | [packages/core/src/types/index.ts:65](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L65) |
| <a id="property-pgp_fingerprint"></a> `pgp_fingerprint?`         | `string`                                       | [packages/core/src/types/index.ts:66](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L66) |
