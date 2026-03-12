[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / isPending

# Function: isPending()

```ts
function isPending(filePath, key): Promise<boolean>;
```

Defined in: [packages/core/src/pending/metadata.ts:121](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/pending/metadata.ts#L121)

Check whether a single key is currently pending for the given encrypted file.

## Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `filePath` | `string` |
| `key`      | `string` |

## Returns

`Promise`\<`boolean`\>
