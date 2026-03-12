[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / checkDependency

# Function: checkDependency()

```ts
function checkDependency(name, runner): Promise<DependencyVersion | null>;
```

Defined in: [packages/core/src/dependencies/checker.ts:77](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/dependencies/checker.ts#L77)

Check a single dependency. Returns null if the binary is not found.
Never throws.

## Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `name`    | `"sops"` \| `"git"`                                     |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

## Returns

`Promise`\<[`DependencyVersion`](../interfaces/DependencyVersion.md) \| `null`\>
