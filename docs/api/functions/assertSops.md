[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / assertSops

# Function: assertSops()

```ts
function assertSops(runner, command?): Promise<void>;
```

Defined in: [packages/core/src/dependencies/checker.ts:140](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/dependencies/checker.ts#L140)

Assert that sops is installed and meets the minimum version.
Throws SopsMissingError or SopsVersionError.

## Parameters

| Parameter  | Type                                                    |
| ---------- | ------------------------------------------------------- |
| `runner`   | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |
| `command?` | `string`                                                |

## Returns

`Promise`\<`void`\>
