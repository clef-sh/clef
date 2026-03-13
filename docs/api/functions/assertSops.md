[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / assertSops

# Function: assertSops()

```ts
function assertSops(runner): Promise<void>;
```

Defined in: [packages/core/src/dependencies/checker.ts:132](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/dependencies/checker.ts#L132)

Assert that sops is installed and meets the minimum version.
Throws SopsMissingError or SopsVersionError.

## Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

## Returns

`Promise`\<`void`\>
