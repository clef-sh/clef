[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DependencyStatus

# Interface: DependencyStatus

Defined in: [packages/core/src/types/index.ts:525](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L525)

Combined dependency check result for all required external tools.

## Properties

| Property                          | Type                                                  | Description                                                       | Defined in                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-git"></a> `git`   | [`DependencyVersion`](DependencyVersion.md) \| `null` | `null` if `git` is not installed or version could not be parsed.  | [packages/core/src/types/index.ts:529](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L529) |
| <a id="property-sops"></a> `sops` | [`DependencyVersion`](DependencyVersion.md) \| `null` | `null` if `sops` is not installed or version could not be parsed. | [packages/core/src/types/index.ts:527](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L527) |
