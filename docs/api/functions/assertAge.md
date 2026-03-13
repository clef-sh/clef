[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / assertAge

# Function: assertAge()

```ts
function assertAge(runner): Promise<void>;
```

Defined in: [packages/core/src/dependencies/checker.ts:148](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/dependencies/checker.ts#L148)

Assert that the age binary is available.
Throws an Error if age is not installed or not in PATH.

## Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

## Returns

`Promise`\<`void`\>
