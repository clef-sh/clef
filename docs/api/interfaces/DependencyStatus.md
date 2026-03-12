[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DependencyStatus

# Interface: DependencyStatus

Defined in: [packages/core/src/types/index.ts:391](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L391)

Combined dependency check result for all required external tools.

## Properties

| Property                          | Type                                                  | Description                                                       | Defined in                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-git"></a> `git`   | [`DependencyVersion`](DependencyVersion.md) \| `null` | `null` if `git` is not installed or version could not be parsed.  | [packages/core/src/types/index.ts:395](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L395) |
| <a id="property-sops"></a> `sops` | [`DependencyVersion`](DependencyVersion.md) \| `null` | `null` if `sops` is not installed or version could not be parsed. | [packages/core/src/types/index.ts:393](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/types/index.ts#L393) |
