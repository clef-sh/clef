[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / checkDependency

# Function: checkDependency()

```ts
function checkDependency(name, runner, commandOverride?): Promise<DependencyVersion | null>;
```

Defined in: [packages/core/src/dependencies/checker.ts:78](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/dependencies/checker.ts#L78)

Check a single dependency. Returns null if the binary is not found.
Never throws.

## Parameters

| Parameter          | Type                                                    |
| ------------------ | ------------------------------------------------------- |
| `name`             | `"sops"` \| `"git"`                                     |
| `runner`           | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |
| `commandOverride?` | `string`                                                |

## Returns

`Promise`\<[`DependencyVersion`](../interfaces/DependencyVersion.md) \| `null`\>
