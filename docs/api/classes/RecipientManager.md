[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / RecipientManager

# Class: RecipientManager

Defined in: [packages/core/src/recipients/index.ts:129](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/recipients/index.ts#L129)

Manages age recipient keys in the manifest and re-encrypts matrix files on add/remove.
All add/remove operations are transactional — a failure triggers a full rollback.

## Example

```ts
const manager = new RecipientManager(runner, matrixManager);
const result = await manager.add("age1...", "Alice", manifest, repoRoot);
```

## Constructors

### Constructor

```ts
new RecipientManager(encryption, matrixManager): RecipientManager;
```

Defined in: [packages/core/src/recipients/index.ts:130](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/recipients/index.ts#L130)

#### Parameters

| Parameter       | Type                                                      |
| --------------- | --------------------------------------------------------- |
| `encryption`    | [`EncryptionBackend`](../interfaces/EncryptionBackend.md) |
| `matrixManager` | [`MatrixManager`](MatrixManager.md)                       |

#### Returns

`RecipientManager`

## Methods

### add()

```ts
add(
   key,
   label,
   manifest,
   repoRoot,
environment?): Promise<RecipientsResult>;
```

Defined in: [packages/core/src/recipients/index.ts:167](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/recipients/index.ts#L167)

Add a new age recipient and re-encrypt all existing matrix files.
Rolls back the manifest and any already-re-encrypted files on failure.

#### Parameters

| Parameter      | Type                                            | Description                                       |
| -------------- | ----------------------------------------------- | ------------------------------------------------- |
| `key`          | `string`                                        | age public key to add (`age1...`).                |
| `label`        | `string` \| `undefined`                         | Optional human-readable label for the recipient.  |
| `manifest`     | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                                  |
| `repoRoot`     | `string`                                        | Absolute path to the repository root.             |
| `environment?` | `string`                                        | Optional environment name to scope the operation. |

#### Returns

`Promise`\<[`RecipientsResult`](../interfaces/RecipientsResult.md)\>

#### Throws

`Error` If the key is invalid or already present.

---

### list()

```ts
list(
   manifest,
   repoRoot,
environment?): Promise<Recipient[]>;
```

Defined in: [packages/core/src/recipients/index.ts:142](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/recipients/index.ts#L142)

List all age recipients declared in the manifest.

#### Parameters

| Parameter      | Type                                            | Description                                           |
| -------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `manifest`     | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                                      |
| `repoRoot`     | `string`                                        | Absolute path to the repository root.                 |
| `environment?` | `string`                                        | Optional environment name to list per-env recipients. |

#### Returns

`Promise`\<[`Recipient`](../interfaces/Recipient.md)[]\>

---

### remove()

```ts
remove(
   key,
   manifest,
   repoRoot,
environment?): Promise<RecipientsResult>;
```

Defined in: [packages/core/src/recipients/index.ts:286](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/recipients/index.ts#L286)

Remove an age recipient and re-encrypt all existing matrix files.
Rolls back on failure. Note: re-encryption removes _future_ access only;
rotate secret values to fully revoke access.

#### Parameters

| Parameter      | Type                                            | Description                                       |
| -------------- | ----------------------------------------------- | ------------------------------------------------- |
| `key`          | `string`                                        | age public key to remove.                         |
| `manifest`     | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                                  |
| `repoRoot`     | `string`                                        | Absolute path to the repository root.             |
| `environment?` | `string`                                        | Optional environment name to scope the operation. |

#### Returns

`Promise`\<[`RecipientsResult`](../interfaces/RecipientsResult.md)\>

#### Throws

`Error` If the key is not in the manifest.
