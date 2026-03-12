[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / checkAll

# Function: checkAll()

```ts
function checkAll(runner): Promise<DependencyStatus>;
```

Defined in: [packages/core/src/dependencies/checker.ts:119](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/dependencies/checker.ts#L119)

Check sops and git dependencies in parallel.

## Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

## Returns

`Promise`\<[`DependencyStatus`](../interfaces/DependencyStatus.md)\>
