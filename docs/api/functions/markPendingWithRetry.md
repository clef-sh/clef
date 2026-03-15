[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / markPendingWithRetry

# Function: markPendingWithRetry()

```ts
function markPendingWithRetry(filePath, keys, setBy, retryDelayMs?): Promise<void>;
```

Defined in: [packages/core/src/pending/metadata.ts:139](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/pending/metadata.ts#L139)

Same as [markPending](markPending.md) but retries once after `retryDelayMs` on transient failure.

## Parameters

| Parameter      | Type       | Default value | Description                                                   |
| -------------- | ---------- | ------------- | ------------------------------------------------------------- |
| `filePath`     | `string`   | `undefined`   | Path to the encrypted file.                                   |
| `keys`         | `string`[] | `undefined`   | Key names to mark as pending.                                 |
| `setBy`        | `string`   | `undefined`   | Identifier of the actor setting these keys.                   |
| `retryDelayMs` | `number`   | `200`         | Delay in milliseconds before the single retry (default: 200). |

## Returns

`Promise`\<`void`\>
