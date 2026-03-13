[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / loadMetadata

# Function: loadMetadata()

```ts
function loadMetadata(filePath): Promise<PendingMetadata>;
```

Defined in: [packages/core/src/pending/metadata.ts:42](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/pending/metadata.ts#L42)

Load pending-key metadata for an encrypted file. Returns empty metadata if the file is missing.

## Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `filePath` | `string` |

## Returns

`Promise`\<[`PendingMetadata`](../interfaces/PendingMetadata.md)\>
