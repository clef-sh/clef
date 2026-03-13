[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DependencyStatus

# Interface: DependencyStatus

Defined in: [packages/core/src/types/index.ts:464](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L464)

Combined dependency check result for all required external tools.

## Properties

| Property                          | Type                                                  | Description                                                       | Defined in                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-git"></a> `git`   | [`DependencyVersion`](DependencyVersion.md) \| `null` | `null` if `git` is not installed or version could not be parsed.  | [packages/core/src/types/index.ts:468](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L468) |
| <a id="property-sops"></a> `sops` | [`DependencyVersion`](DependencyVersion.md) \| `null` | `null` if `sops` is not installed or version could not be parsed. | [packages/core/src/types/index.ts:466](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L466) |
