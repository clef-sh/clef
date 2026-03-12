[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / RecipientManager

# Class: RecipientManager

Defined in: [packages/core/src/recipients/index.ts:97](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/recipients/index.ts#L97)

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
new RecipientManager(runner, matrixManager): RecipientManager;
```

Defined in: [packages/core/src/recipients/index.ts:98](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/recipients/index.ts#L98)

#### Parameters

| Parameter       | Type                                                    |
| --------------- | ------------------------------------------------------- |
| `runner`        | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |
| `matrixManager` | [`MatrixManager`](MatrixManager.md)                     |

#### Returns

`RecipientManager`

## Methods

### add()

```ts
add(
   key,
   label,
   manifest,
repoRoot): Promise<RecipientsResult>;
```

Defined in: [packages/core/src/recipients/index.ts:125](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/recipients/index.ts#L125)

Add a new age recipient and re-encrypt all existing matrix files.
Rolls back the manifest and any already-re-encrypted files on failure.

#### Parameters

| Parameter  | Type                                            | Description                                      |
| ---------- | ----------------------------------------------- | ------------------------------------------------ |
| `key`      | `string`                                        | Age public key to add (`age1...`).               |
| `label`    | `string` \| `undefined`                         | Optional human-readable label for the recipient. |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                                 |
| `repoRoot` | `string`                                        | Absolute path to the repository root.            |

#### Returns

`Promise`\<[`RecipientsResult`](../interfaces/RecipientsResult.md)\>

#### Throws

`Error` If the key is invalid or already present.

---

### list()

```ts
list(manifest, repoRoot): Promise<Recipient[]>;
```

Defined in: [packages/core/src/recipients/index.ts:109](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/recipients/index.ts#L109)

List all age recipients declared in the manifest.

#### Parameters

| Parameter  | Type                                            | Description                           |
| ---------- | ----------------------------------------------- | ------------------------------------- |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                      |
| `repoRoot` | `string`                                        | Absolute path to the repository root. |

#### Returns

`Promise`\<[`Recipient`](../interfaces/Recipient.md)[]\>

---

### remove()

```ts
remove(
   key,
   manifest,
repoRoot): Promise<RecipientsResult>;
```

Defined in: [packages/core/src/recipients/index.ts:236](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/recipients/index.ts#L236)

Remove an age recipient and re-encrypt all existing matrix files.
Rolls back on failure. Note: re-encryption removes _future_ access only;
rotate secret values to fully revoke access.

#### Parameters

| Parameter  | Type                                            | Description                           |
| ---------- | ----------------------------------------------- | ------------------------------------- |
| `key`      | `string`                                        | Age public key to remove.             |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                      |
| `repoRoot` | `string`                                        | Absolute path to the repository root. |

#### Returns

`Promise`\<[`RecipientsResult`](../interfaces/RecipientsResult.md)\>

#### Throws

`Error` If the key is not in the manifest.
