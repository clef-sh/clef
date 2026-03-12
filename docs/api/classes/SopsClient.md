[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SopsClient

# Class: SopsClient

Defined in: [packages/core/src/sops/client.ts:39](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/sops/client.ts#L39)

Wraps the `sops` binary for encryption, decryption, re-encryption, and metadata extraction.
All decrypt/encrypt operations are piped via stdin/stdout — plaintext never touches disk.

## Example

```ts
const client = new SopsClient(runner, "/home/user/.age/key.txt");
const decrypted = await client.decrypt("secrets/production.enc.yaml");
```

## Constructors

### Constructor

```ts
new SopsClient(runner, ageKeyFile?): SopsClient;
```

Defined in: [packages/core/src/sops/client.ts:45](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/sops/client.ts#L45)

#### Parameters

| Parameter     | Type                                                    | Description                                                                                                                                     |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `runner`      | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) | Subprocess runner used to invoke the `sops` binary.                                                                                             |
| `ageKeyFile?` | `string`                                                | Optional path to an age private key file. Sets `SOPS_AGE_KEY_FILE` in subprocess calls when no age key environment variable is already present. |

#### Returns

`SopsClient`

## Methods

### decrypt()

```ts
decrypt(filePath): Promise<DecryptedFile>;
```

Defined in: [packages/core/src/sops/client.ts:68](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/sops/client.ts#L68)

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

---

### encrypt()

```ts
encrypt(
   filePath,
   values,
manifest): Promise<void>;
```

Defined in: [packages/core/src/sops/client.ts:117](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/sops/client.ts#L117)

Encrypt a key/value map and write it to an encrypted SOPS file.

#### Parameters

| Parameter  | Type                                            | Description                                                              |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| `filePath` | `string`                                        | Destination path for the encrypted file.                                 |
| `values`   | `Record`\<`string`, `string`\>                  | Flat key/value map to encrypt.                                           |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Manifest used to determine the encryption backend and key configuration. |

#### Returns

`Promise`\<`void`\>

#### Throws

[SopsEncryptionError](SopsEncryptionError.md) On encryption or write failure.

---

### getMetadata()

```ts
getMetadata(filePath): Promise<SopsMetadata>;
```

Defined in: [packages/core/src/sops/client.ts:209](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/sops/client.ts#L209)

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

---

### reEncrypt()

```ts
reEncrypt(filePath, newKey): Promise<void>;
```

Defined in: [packages/core/src/sops/client.ts:170](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/sops/client.ts#L170)

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

---

### validateEncryption()

```ts
validateEncryption(filePath): Promise<boolean>;
```

Defined in: [packages/core/src/sops/client.ts:191](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/sops/client.ts#L191)

Check whether a file contains valid SOPS encryption metadata.

#### Parameters

| Parameter  | Type     | Description                |
| ---------- | -------- | -------------------------- |
| `filePath` | `string` | Path to the file to check. |

#### Returns

`Promise`\<`boolean`\>

`true` if valid SOPS metadata is present; `false` otherwise. Never throws.
