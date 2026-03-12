[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / DiffEngine

# Class: DiffEngine

Defined in: [packages/core/src/diff/engine.ts:26](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/diff/engine.ts#L26)

Compares decrypted values between two environments or two arbitrary key/value maps.

## Example

```ts
const engine = new DiffEngine();
const result = await engine.diffFiles(
  "app",
  "staging",
  "production",
  manifest,
  sopsClient,
  repoRoot,
);
```

## Constructors

### Constructor

```ts
new DiffEngine(): DiffEngine;
```

#### Returns

`DiffEngine`

## Methods

### diff()

```ts
diff(
   valuesA,
   valuesB,
   envA,
   envB,
   namespace?): DiffResult;
```

Defined in: [packages/core/src/diff/engine.ts:38](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/diff/engine.ts#L38)

Compare two in-memory value maps and produce a sorted diff result.

Rows are sorted with missing and changed keys first, identical keys last.

#### Parameters

| Parameter   | Type                           | Default value | Description                                        |
| ----------- | ------------------------------ | ------------- | -------------------------------------------------- |
| `valuesA`   | `Record`\<`string`, `string`\> | `undefined`   | Decrypted values from environment A.               |
| `valuesB`   | `Record`\<`string`, `string`\> | `undefined`   | Decrypted values from environment B.               |
| `envA`      | `string`                       | `undefined`   | Name of environment A.                             |
| `envB`      | `string`                       | `undefined`   | Name of environment B.                             |
| `namespace` | `string`                       | `""`          | Namespace label included in the result (optional). |

#### Returns

[`DiffResult`](../interfaces/DiffResult.md)

---

### diffFiles()

```ts
diffFiles(
   namespace,
   envA,
   envB,
   manifest,
   sopsClient,
repoRoot): Promise<DiffResult>;
```

Defined in: [packages/core/src/diff/engine.ts:94](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/diff/engine.ts#L94)

Decrypt two matrix cells and diff their values.

#### Parameters

| Parameter    | Type                                            | Description                                 |
| ------------ | ----------------------------------------------- | ------------------------------------------- |
| `namespace`  | `string`                                        | Namespace containing both cells.            |
| `envA`       | `string`                                        | Name of environment A.                      |
| `envB`       | `string`                                        | Name of environment B.                      |
| `manifest`   | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest used to resolve file paths. |
| `sopsClient` | [`SopsClient`](SopsClient.md)                   | SOPS client used to decrypt both files.     |
| `repoRoot`   | `string`                                        | Absolute path to the repository root.       |

#### Returns

`Promise`\<[`DiffResult`](../interfaces/DiffResult.md)\>

#### Throws

[SopsDecryptionError](SopsDecryptionError.md) If either file cannot be decrypted.
