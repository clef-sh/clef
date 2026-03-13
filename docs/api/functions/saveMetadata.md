[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / saveMetadata

# Function: saveMetadata()

```ts
function saveMetadata(filePath, metadata): Promise<void>;
```

Defined in: [packages/core/src/pending/metadata.ts:67](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/pending/metadata.ts#L67)

Write pending-key metadata to disk. Creates parent directories if needed.

## Parameters

| Parameter  | Type                                                  |
| ---------- | ----------------------------------------------------- |
| `filePath` | `string`                                              |
| `metadata` | [`PendingMetadata`](../interfaces/PendingMetadata.md) |

## Returns

`Promise`\<`void`\>
