[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / EncryptionBackend

# Interface: EncryptionBackend

Defined in: [packages/core/src/types/index.ts:302](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L302)

Backend-agnostic interface for all encryption/decryption operations.

`SopsClient` is the canonical implementation. Consumers should depend on this
interface rather than the concrete class so the encryption backend can be
replaced without touching call sites.

## Methods

### addRecipient()

```ts
addRecipient(filePath, key): Promise<void>;
```

Defined in: [packages/core/src/types/index.ts:315](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L315)

Add an age recipient to an encrypted file (rotate + add-age).

#### Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `filePath` | `string` |
| `key`      | `string` |

#### Returns

`Promise`\<`void`\>

---

### decrypt()

```ts
decrypt(filePath): Promise<DecryptedFile>;
```

Defined in: [packages/core/src/types/index.ts:304](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L304)

Decrypt a file and return its values and metadata.

#### Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `filePath` | `string` |

#### Returns

`Promise`\<[`DecryptedFile`](DecryptedFile.md)\>

---

### encrypt()

```ts
encrypt(
   filePath,
   values,
   manifest,
environment?): Promise<void>;
```

Defined in: [packages/core/src/types/index.ts:306](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L306)

Encrypt a key/value map and write it to a file.

#### Parameters

| Parameter      | Type                              |
| -------------- | --------------------------------- |
| `filePath`     | `string`                          |
| `values`       | `Record`\<`string`, `string`\>    |
| `manifest`     | [`ClefManifest`](ClefManifest.md) |
| `environment?` | `string`                          |

#### Returns

`Promise`\<`void`\>

---

### getMetadata()

```ts
getMetadata(filePath): Promise<SopsMetadata>;
```

Defined in: [packages/core/src/types/index.ts:321](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L321)

Extract encryption metadata without decrypting.

#### Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `filePath` | `string` |

#### Returns

`Promise`\<[`SopsMetadata`](SopsMetadata.md)\>

---

### reEncrypt()

```ts
reEncrypt(filePath, newKey): Promise<void>;
```

Defined in: [packages/core/src/types/index.ts:313](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L313)

Rotate encryption by adding a new recipient key.

#### Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `filePath` | `string` |
| `newKey`   | `string` |

#### Returns

`Promise`\<`void`\>

---

### removeRecipient()

```ts
removeRecipient(filePath, key): Promise<void>;
```

Defined in: [packages/core/src/types/index.ts:317](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L317)

Remove an age recipient from an encrypted file (rotate + rm-age).

#### Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `filePath` | `string` |
| `key`      | `string` |

#### Returns

`Promise`\<`void`\>

---

### validateEncryption()

```ts
validateEncryption(filePath): Promise<boolean>;
```

Defined in: [packages/core/src/types/index.ts:319](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L319)

Check whether a file has valid encryption metadata.

#### Parameters

| Parameter  | Type     |
| ---------- | -------- |
| `filePath` | `string` |

#### Returns

`Promise`\<`boolean`\>
