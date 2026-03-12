[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ClefLocalConfig

# Interface: ClefLocalConfig

Defined in: [packages/core/src/types/index.ts:73](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L73)

Per-developer local config stored in `.clef/config.yaml` (gitignored).
Holds settings that must not be committed, such as the age private key path.

## Properties

| Property                                           | Type     | Description                                          | Defined in                                                                                                                                                |
| -------------------------------------------------- | -------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-age_key_file"></a> `age_key_file?` | `string` | Path to the age private key file for this developer. | [packages/core/src/types/index.ts:75](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L75) |
