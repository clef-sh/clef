[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ClefLocalConfig

# Interface: ClefLocalConfig

Defined in: [packages/core/src/types/index.ts:118](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L118)

Per-developer local config stored in `.clef/config.yaml` (gitignored).
Holds settings that must not be committed, such as the age private key path.

## Properties

| Property                                                       | Type                     | Description                                                                                                                                                                                                                                                | Defined in                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-age_key_file"></a> `age_key_file?`             | `string`                 | Path to the age private key file for this developer.                                                                                                                                                                                                       | [packages/core/src/types/index.ts:120](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L120) |
| <a id="property-age_key_storage"></a> `age_key_storage?`       | `"keychain"` \| `"file"` | Where the age private key was stored during init. - "keychain" — OS keychain (macOS Keychain / Linux libsecret / Windows Credential Manager) - "file" — filesystem at age_key_file path Used to provide targeted guidance when the key cannot be resolved. | [packages/core/src/types/index.ts:128](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L128) |
| <a id="property-age_keychain_label"></a> `age_keychain_label?` | `string`                 | Label identifying this repo's age key in the OS keychain or filesystem.                                                                                                                                                                                    | [packages/core/src/types/index.ts:130](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L130) |
