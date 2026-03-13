[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SopsMergeDriver

# Class: SopsMergeDriver

Defined in: [packages/core/src/merge/driver.ts:48](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L48)

Three-way merge driver for SOPS-encrypted files.

Decrypts the base (common ancestor), ours (current branch), and theirs (incoming branch)
versions of a file, performs a three-way merge on the plaintext key/value maps, and
returns the merged result for re-encryption.

## Example

```ts
const driver = new SopsMergeDriver(sopsClient);
const result = await driver.mergeFiles(basePath, oursPath, theirsPath);
if (result.clean) {
  await sopsClient.encrypt(oursPath, result.merged, manifest, environment);
}
```

## Constructors

### Constructor

```ts
new SopsMergeDriver(sopsClient): SopsMergeDriver;
```

Defined in: [packages/core/src/merge/driver.ts:49](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L49)

#### Parameters

| Parameter    | Type                                                      |
| ------------ | --------------------------------------------------------- |
| `sopsClient` | [`EncryptionBackend`](../interfaces/EncryptionBackend.md) |

#### Returns

`SopsMergeDriver`

## Methods

### merge()

```ts
merge(
   base,
   ours,
   theirs): MergeResult;
```

Defined in: [packages/core/src/merge/driver.ts:61](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L61)

Perform a three-way merge on three in-memory key/value maps.

Algorithm: For each key across all three maps, compare ours and theirs against base.

- If only one side changed relative to base, take that side's value.
- If both sides made the same change, take either (they agree).
- If both sides made different changes to the same key, it's a conflict.
- If a key was added on both sides with the same value, accept it.
- If a key was added on both sides with different values, it's a conflict.

#### Parameters

| Parameter | Type                           |
| --------- | ------------------------------ |
| `base`    | `Record`\<`string`, `string`\> |
| `ours`    | `Record`\<`string`, `string`\> |
| `theirs`  | `Record`\<`string`, `string`\> |

#### Returns

[`MergeResult`](../interfaces/MergeResult.md)

---

### mergeFiles()

```ts
mergeFiles(
   basePath,
   oursPath,
theirsPath): Promise<MergeResult>;
```

Defined in: [packages/core/src/merge/driver.ts:141](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/merge/driver.ts#L141)

Decrypt three file versions and perform a three-way merge.

#### Parameters

| Parameter    | Type     | Description                                |
| ------------ | -------- | ------------------------------------------ |
| `basePath`   | `string` | Path to the common ancestor file (git %O). |
| `oursPath`   | `string` | Path to the current branch file (git %A).  |
| `theirsPath` | `string` | Path to the incoming branch file (git %B). |

#### Returns

`Promise`\<[`MergeResult`](../interfaces/MergeResult.md)\>

The merge result. When `clean` is `true`, `merged` contains the resolved values.
