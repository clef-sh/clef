[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SopsClient

# Class: SopsClient

Defined in: [packages/core/src/sops/client.ts:41](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/sops/client.ts#L41)

Wraps the `sops` binary for encryption, decryption, re-encryption, and metadata extraction.
All decrypt/encrypt operations are piped via stdin/stdout — plaintext never touches disk.

## Example

```ts
const client = new SopsClient(runner, "/home/user/.age/key.txt");
const decrypted = await client.decrypt("secrets/production.enc.yaml");
```

## Implements

- [`EncryptionBackend`](../interfaces/EncryptionBackend.md)

## Constructors

### Constructor

```ts
new SopsClient(runner, ageKeyFile?): SopsClient;
```

Defined in: [packages/core/src/sops/client.ts:47](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/sops/client.ts#L47)

#### Parameters

| Parameter     | Type                                                    | Description                                                                                                                                     |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `runner`      | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) | Subprocess runner used to invoke the `sops` binary.                                                                                             |
| `ageKeyFile?` | `string`                                                | Optional path to an age private key file. Sets `SOPS_AGE_KEY_FILE` in subprocess calls when no age key environment variable is already present. |

#### Returns

`SopsClient`

## Methods

### addRecipient()

```ts
addRecipient(filePath, key): Promise<void>;
```

Defined in: [packages/core/src/sops/client.ts:197](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/sops/client.ts#L197)

Add an age recipient to an existing SOPS file.

#### Parameters

| Parameter  | Type     | Description                           |
| ---------- | -------- | ------------------------------------- |
| `filePath` | `string` | Path to the encrypted file.           |
| `key`      | `string` | age public key to add as a recipient. |

#### Returns

`Promise`\<`void`\>

#### Throws

[SopsEncryptionError](SopsEncryptionError.md) On failure.

#### Implementation of

[`EncryptionBackend`](../interfaces/EncryptionBackend.md).[`addRecipient`](../interfaces/EncryptionBackend.md#addrecipient)

---

### decrypt()

```ts
decrypt(filePath): Promise<DecryptedFile>;
```

Defined in: [packages/core/src/sops/client.ts:70](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/sops/client.ts#L70)

Decrypt a SOPS-encrypted file and return its values and metadata.

#### Parameters

| Parameter  | Type     | Description                                  |
| ---------- | -------- | -------------------------------------------- |
| `filePath` | `string` | Path to the `.enc.yaml` or `.enc.json` file. |

#### Returns

`Promise`\<[`DecryptedFile`](../interfaces/DecryptedFile.md)\>

[DecryptedFile](../interfaces/DecryptedFile.md) with plaintext values in memory only.

#### Throws

[SopsKeyNotFoundError](SopsKeyNotFoundError.md) If no matching decryption key is available.

#### Throws

[SopsDecryptionError](SopsDecryptionError.md) On any other decryption failure.

#### Implementation of

[`EncryptionBackend`](../interfaces/EncryptionBackend.md).[`decrypt`](../interfaces/EncryptionBackend.md#decrypt)

---

### encrypt()

```ts
encrypt(
   filePath,
   values,
   manifest,
environment?): Promise<void>;
```

Defined in: [packages/core/src/sops/client.ts:121](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/sops/client.ts#L121)

Encrypt a key/value map and write it to an encrypted SOPS file.

#### Parameters

| Parameter      | Type                                            | Description                                                                                                                                                  |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `filePath`     | `string`                                        | Destination path for the encrypted file.                                                                                                                     |
| `values`       | `Record`\<`string`, `string`\>                  | Flat key/value map to encrypt.                                                                                                                               |
| `manifest`     | [`ClefManifest`](../interfaces/ClefManifest.md) | Manifest used to determine the encryption backend and key configuration.                                                                                     |
| `environment?` | `string`                                        | Optional environment name. When provided, per-env backend overrides are resolved from the manifest. When omitted, the global `sops.default_backend` is used. |

#### Returns

`Promise`\<`void`\>

#### Throws

[SopsEncryptionError](SopsEncryptionError.md) On encryption or write failure.

#### Implementation of

[`EncryptionBackend`](../interfaces/EncryptionBackend.md).[`encrypt`](../interfaces/EncryptionBackend.md#encrypt)

---

### getMetadata()

```ts
getMetadata(filePath): Promise<SopsMetadata>;
```

Defined in: [packages/core/src/sops/client.ts:258](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/sops/client.ts#L258)

Extract SOPS metadata (backend, recipients, last-modified timestamp) from an encrypted file
without decrypting its values.

#### Parameters

| Parameter  | Type     | Description                 |
| ---------- | -------- | --------------------------- |
| `filePath` | `string` | Path to the encrypted file. |

#### Returns

`Promise`\<[`SopsMetadata`](../interfaces/SopsMetadata.md)\>

[SopsMetadata](../interfaces/SopsMetadata.md) parsed from the file's `sops:` block.

#### Throws

[SopsDecryptionError](SopsDecryptionError.md) If the file cannot be read or parsed.

#### Implementation of

[`EncryptionBackend`](../interfaces/EncryptionBackend.md).[`getMetadata`](../interfaces/EncryptionBackend.md#getmetadata)

---

### reEncrypt()

```ts
reEncrypt(filePath, newKey): Promise<void>;
```

Defined in: [packages/core/src/sops/client.ts:175](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/sops/client.ts#L175)

Rotate encryption by adding a new age recipient key to an existing SOPS file.

#### Parameters

| Parameter  | Type     | Description                               |
| ---------- | -------- | ----------------------------------------- |
| `filePath` | `string` | Path to the encrypted file to re-encrypt. |
| `newKey`   | `string` | New age public key to add as a recipient. |

#### Returns

`Promise`\<`void`\>

#### Throws

[SopsEncryptionError](SopsEncryptionError.md) On failure.

#### Implementation of

[`EncryptionBackend`](../interfaces/EncryptionBackend.md).[`reEncrypt`](../interfaces/EncryptionBackend.md#reencrypt)

---

### removeRecipient()

```ts
removeRecipient(filePath, key): Promise<void>;
```

Defined in: [packages/core/src/sops/client.ts:219](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/sops/client.ts#L219)

Remove an age recipient from an existing SOPS file.

#### Parameters

| Parameter  | Type     | Description                 |
| ---------- | -------- | --------------------------- |
| `filePath` | `string` | Path to the encrypted file. |
| `key`      | `string` | age public key to remove.   |

#### Returns

`Promise`\<`void`\>

#### Throws

[SopsEncryptionError](SopsEncryptionError.md) On failure.

#### Implementation of

[`EncryptionBackend`](../interfaces/EncryptionBackend.md).[`removeRecipient`](../interfaces/EncryptionBackend.md#removerecipient)

---

### validateEncryption()

```ts
validateEncryption(filePath): Promise<boolean>;
```

Defined in: [packages/core/src/sops/client.ts:240](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/sops/client.ts#L240)

Check whether a file contains valid SOPS encryption metadata.

#### Parameters

| Parameter  | Type     | Description                |
| ---------- | -------- | -------------------------- |
| `filePath` | `string` | Path to the file to check. |

#### Returns

`Promise`\<`boolean`\>

`true` if valid SOPS metadata is present; `false` otherwise. Never throws.

#### Implementation of

[`EncryptionBackend`](../interfaces/EncryptionBackend.md).[`validateEncryption`](../interfaces/EncryptionBackend.md#validateencryption)
