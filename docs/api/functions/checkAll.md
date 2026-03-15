[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / checkAll

# Function: checkAll()

```ts
function checkAll(runner): Promise<DependencyStatus>;
```

Defined in: [packages/core/src/dependencies/checker.ts:127](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/dependencies/checker.ts#L127)

Check sops and git dependencies in parallel.

## Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

## Returns

`Promise`\<[`DependencyStatus`](../interfaces/DependencyStatus.md)\>
