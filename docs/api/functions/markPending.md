[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / markPending

# Function: markPending()

```ts
function markPending(filePath, keys, setBy): Promise<void>;
```

Defined in: [packages/core/src/pending/metadata.ts:92](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/pending/metadata.ts#L92)

Mark one or more keys as pending (placeholder value) for an encrypted file.
If a key is already pending, its timestamp and `setBy` are updated.

## Parameters

| Parameter  | Type       | Description                                                             |
| ---------- | ---------- | ----------------------------------------------------------------------- |
| `filePath` | `string`   | Path to the encrypted file.                                             |
| `keys`     | `string`[] | Key names to mark as pending.                                           |
| `setBy`    | `string`   | Identifier of the actor setting these keys (e.g. a username or CI job). |

## Returns

`Promise`\<`void`\>
