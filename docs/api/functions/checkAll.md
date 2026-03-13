[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / checkAll

# Function: checkAll()

```ts
function checkAll(runner): Promise<DependencyStatus>;
```

Defined in: [packages/core/src/dependencies/checker.ts:119](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/dependencies/checker.ts#L119)

Check sops and git dependencies in parallel.

## Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

## Returns

`Promise`\<[`DependencyStatus`](../interfaces/DependencyStatus.md)\>
