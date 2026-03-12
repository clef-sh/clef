[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / BulkOps

# Class: BulkOps

Defined in: [packages/core/src/bulk/ops.ts:14](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/bulk/ops.ts#L14)

Performs bulk set, delete, and copy operations across multiple environments.

## Example

```ts
const bulk = new BulkOps();
await bulk.setAcrossEnvironments(
  "app",
  "DATABASE_URL",
  { staging: "...", production: "..." },
  manifest,
  sopsClient,
  repoRoot,
);
```

## Constructors

### Constructor

```ts
new BulkOps(): BulkOps;
```

#### Returns

`BulkOps`

## Methods

### copyValue()

```ts
copyValue(
   key,
   fromCell,
   toCell,
   sopsClient,
manifest): Promise<void>;
```

Defined in: [packages/core/src/bulk/ops.ts:118](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/bulk/ops.ts#L118)

Copy a single key's value from one matrix cell to another.

#### Parameters

| Parameter    | Type                                            | Description              |
| ------------ | ----------------------------------------------- | ------------------------ |
| `key`        | `string`                                        | Secret key name to copy. |
| `fromCell`   | [`MatrixCell`](../interfaces/MatrixCell.md)     | Source matrix cell.      |
| `toCell`     | [`MatrixCell`](../interfaces/MatrixCell.md)     | Destination matrix cell. |
| `sopsClient` | [`SopsClient`](SopsClient.md)                   | SOPS client.             |
| `manifest`   | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.         |

#### Returns

`Promise`\<`void`\>

#### Throws

`Error` if the key does not exist in the source cell.

---

### deleteAcrossEnvironments()

```ts
deleteAcrossEnvironments(
   namespace,
   key,
   manifest,
   sopsClient,
repoRoot): Promise<void>;
```

Defined in: [packages/core/src/bulk/ops.ts:74](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/bulk/ops.ts#L74)

Delete a key from every environment in a namespace.

#### Parameters

| Parameter    | Type                                            | Description                           |
| ------------ | ----------------------------------------------- | ------------------------------------- |
| `namespace`  | `string`                                        | Target namespace.                     |
| `key`        | `string`                                        | Secret key name to delete.            |
| `manifest`   | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                      |
| `sopsClient` | [`SopsClient`](SopsClient.md)                   | SOPS client.                          |
| `repoRoot`   | `string`                                        | Absolute path to the repository root. |

#### Returns

`Promise`\<`void`\>

#### Throws

`Error` with details if any environment fails.

---

### setAcrossEnvironments()

```ts
setAcrossEnvironments(
   namespace,
   key,
   values,
   manifest,
   sopsClient,
repoRoot): Promise<void>;
```

Defined in: [packages/core/src/bulk/ops.ts:26](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/bulk/ops.ts#L26)

Set a key to different values in multiple environments at once.

#### Parameters

| Parameter    | Type                                            | Description                                           |
| ------------ | ----------------------------------------------- | ----------------------------------------------------- |
| `namespace`  | `string`                                        | Target namespace.                                     |
| `key`        | `string`                                        | Secret key name to set.                               |
| `values`     | `Record`\<`string`, `string`\>                  | Map of `{ environment: value }` pairs.                |
| `manifest`   | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                                      |
| `sopsClient` | [`SopsClient`](SopsClient.md)                   | SOPS client used to decrypt and re-encrypt each file. |
| `repoRoot`   | `string`                                        | Absolute path to the repository root.                 |

#### Returns

`Promise`\<`void`\>

#### Throws

`Error` with details if any environment fails.
