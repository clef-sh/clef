[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / checkDependency

# Function: checkDependency()

```ts
function checkDependency(name, runner): Promise<DependencyVersion | null>;
```

Defined in: [packages/core/src/dependencies/checker.ts:77](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/dependencies/checker.ts#L77)

Check a single dependency. Returns null if the binary is not found.
Never throws.

## Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `name`    | `"sops"` \| `"git"`                                     |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

## Returns

`Promise`\<[`DependencyVersion`](../interfaces/DependencyVersion.md) \| `null`\>
