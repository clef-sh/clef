[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / metadataPath

# Function: metadataPath()

```ts
function metadataPath(encryptedFilePath): string;
```

Defined in: [packages/core/src/pending/metadata.ts:33](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/pending/metadata.ts#L33)

Derive the `.clef-meta.yaml` path from an `.enc.yaml` path.
Example: `database/dev.enc.yaml` → `database/dev.clef-meta.yaml`

## Parameters

| Parameter           | Type     |
| ------------------- | -------- |
| `encryptedFilePath` | `string` |

## Returns

`string`
