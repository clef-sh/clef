[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / getPendingKeys

# Function: getPendingKeys()

```ts
function getPendingKeys(filePath): Promise<string[]>;
```

Defined in: [packages/core/src/pending/metadata.ts:115](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/pending/metadata.ts#L115)

Return the list of key names that are still pending for the given encrypted file.

## Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `filePath` | `string` |

## Returns

`Promise`\<`string`[]\>
