[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / saveMetadata

# Function: saveMetadata()

```ts
function saveMetadata(filePath, metadata): Promise<void>;
```

Defined in: [packages/core/src/pending/metadata.ts:67](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/pending/metadata.ts#L67)

Write pending-key metadata to disk. Creates parent directories if needed.

## Parameters

| Parameter  | Type                                                  |
| ---------- | ----------------------------------------------------- |
| `filePath` | `string`                                              |
| `metadata` | [`PendingMetadata`](../interfaces/PendingMetadata.md) |

## Returns

`Promise`\<`void`\>
