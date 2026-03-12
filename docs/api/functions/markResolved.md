[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / markResolved

# Function: markResolved()

```ts
function markResolved(filePath, keys): Promise<void>;
```

Defined in: [packages/core/src/pending/metadata.ts:108](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/pending/metadata.ts#L108)

Remove keys from the pending list after they have received real values.

## Parameters

| Parameter  | Type       |
| ---------- | ---------- |
| `filePath` | `string`   |
| `keys`     | `string`[] |

## Returns

`Promise`\<`void`\>
