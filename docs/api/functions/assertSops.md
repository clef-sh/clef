[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / assertSops

# Function: assertSops()

```ts
function assertSops(runner): Promise<void>;
```

Defined in: [packages/core/src/dependencies/checker.ts:132](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/dependencies/checker.ts#L132)

Assert that sops is installed and meets the minimum version.
Throws SopsMissingError or SopsVersionError.

## Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

## Returns

`Promise`\<`void`\>
