[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ClefLocalConfig

# Interface: ClefLocalConfig

Defined in: [packages/core/src/types/index.ts:117](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L117)

Per-developer local config stored in `.clef/config.yaml` (gitignored).
Holds settings that must not be committed, such as the age private key path.

## Properties

| Property                                           | Type     | Description                                          | Defined in                                                                                                                                                  |
| -------------------------------------------------- | -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-age_key_file"></a> `age_key_file?` | `string` | Path to the age private key file for this developer. | [packages/core/src/types/index.ts:119](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L119) |
