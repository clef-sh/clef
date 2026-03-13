[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / MatrixManager

# Class: MatrixManager

Defined in: [packages/core/src/matrix/manager.ts:16](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/matrix/manager.ts#L16)

Resolves and manages the namespace × environment matrix of encrypted files.

## Example

```ts
const manager = new MatrixManager();
const cells = manager.resolveMatrix(manifest, repoRoot);
```

## Constructors

### Constructor

```ts
new MatrixManager(): MatrixManager;
```

#### Returns

`MatrixManager`

## Methods

### detectMissingCells()

```ts
detectMissingCells(manifest, repoRoot): MatrixCell[];
```

Defined in: [packages/core/src/matrix/manager.ts:52](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/matrix/manager.ts#L52)

Return only the cells whose encrypted files do not yet exist on disk.

#### Parameters

| Parameter  | Type                                            | Description                           |
| ---------- | ----------------------------------------------- | ------------------------------------- |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                      |
| `repoRoot` | `string`                                        | Absolute path to the repository root. |

#### Returns

[`MatrixCell`](../interfaces/MatrixCell.md)[]

---

### getMatrixStatus()

```ts
getMatrixStatus(
   manifest,
   repoRoot,
sopsClient): Promise<MatrixStatus[]>;
```

Defined in: [packages/core/src/matrix/manager.ts:83](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/matrix/manager.ts#L83)

Decrypt each cell and return key counts, pending counts, and cross-environment issues.

#### Parameters

| Parameter    | Type                                                      | Description                            |
| ------------ | --------------------------------------------------------- | -------------------------------------- |
| `manifest`   | [`ClefManifest`](../interfaces/ClefManifest.md)           | Parsed manifest.                       |
| `repoRoot`   | `string`                                                  | Absolute path to the repository root.  |
| `sopsClient` | [`EncryptionBackend`](../interfaces/EncryptionBackend.md) | SOPS client used to decrypt each cell. |

#### Returns

`Promise`\<[`MatrixStatus`](../interfaces/MatrixStatus.md)[]\>

---

### isProtectedEnvironment()

```ts
isProtectedEnvironment(manifest, environment): boolean;
```

Defined in: [packages/core/src/matrix/manager.ts:173](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/matrix/manager.ts#L173)

Check whether an environment has the `protected` flag set in the manifest.

#### Parameters

| Parameter     | Type                                            | Description                |
| ------------- | ----------------------------------------------- | -------------------------- |
| `manifest`    | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.           |
| `environment` | `string`                                        | Environment name to check. |

#### Returns

`boolean`

---

### resolveMatrix()

```ts
resolveMatrix(manifest, repoRoot): MatrixCell[];
```

Defined in: [packages/core/src/matrix/manager.ts:24](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/matrix/manager.ts#L24)

Build the full grid of [MatrixCell](../interfaces/MatrixCell.md) objects from the manifest.
Each cell reflects whether its encrypted file exists on disk.

#### Parameters

| Parameter  | Type                                            | Description                           |
| ---------- | ----------------------------------------------- | ------------------------------------- |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                      |
| `repoRoot` | `string`                                        | Absolute path to the repository root. |

#### Returns

[`MatrixCell`](../interfaces/MatrixCell.md)[]

---

### scaffoldCell()

```ts
scaffoldCell(
   cell,
   sopsClient,
manifest): Promise<void>;
```

Defined in: [packages/core/src/matrix/manager.ts:63](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/matrix/manager.ts#L63)

Create an empty encrypted SOPS file for a missing matrix cell.

#### Parameters

| Parameter    | Type                                                      | Description                                               |
| ------------ | --------------------------------------------------------- | --------------------------------------------------------- |
| `cell`       | [`MatrixCell`](../interfaces/MatrixCell.md)               | The cell to scaffold (must not already exist).            |
| `sopsClient` | [`EncryptionBackend`](../interfaces/EncryptionBackend.md) | SOPS client used to write the initial encrypted file.     |
| `manifest`   | [`ClefManifest`](../interfaces/ClefManifest.md)           | Parsed manifest used to determine the encryption backend. |

#### Returns

`Promise`\<`void`\>
