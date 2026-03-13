[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / isPending

# Function: isPending()

```ts
function isPending(filePath, key): Promise<boolean>;
```

Defined in: [packages/core/src/pending/metadata.ts:121](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/pending/metadata.ts#L121)

Check whether a single key is currently pending for the given encrypted file.

## Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `filePath` | `string` |
| `key`      | `string` |

## Returns

`Promise`\<`boolean`\>
