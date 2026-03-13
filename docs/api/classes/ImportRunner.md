[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ImportRunner

# Class: ImportRunner

Defined in: [packages/core/src/import/index.ts:33](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/import/index.ts#L33)

Imports secrets from `.env`, JSON, or YAML files into encrypted matrix cells.

## Example

```ts
const runner = new ImportRunner(sopsClient);
const result = await runner.import("app/staging", null, envContent, manifest, repoRoot, {
  format: "dotenv",
});
```

## Constructors

### Constructor

```ts
new ImportRunner(sopsClient): ImportRunner;
```

Defined in: [packages/core/src/import/index.ts:34](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/import/index.ts#L34)

#### Parameters

| Parameter    | Type                                                      |
| ------------ | --------------------------------------------------------- |
| `sopsClient` | [`EncryptionBackend`](../interfaces/EncryptionBackend.md) |

#### Returns

`ImportRunner`

## Methods

### import()

```ts
import(
   target,
   sourcePath,
   content,
   manifest,
   repoRoot,
options): Promise<ImportResult>;
```

Defined in: [packages/core/src/import/index.ts:46](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/import/index.ts#L46)

Parse a source file and import its key/value pairs into a target `namespace/environment` cell.

#### Parameters

| Parameter    | Type                                              | Description                                                                       |
| ------------ | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `target`     | `string`                                          | Target cell in `namespace/environment` format.                                    |
| `sourcePath` | `string` \| `null`                                | Source file path used for format detection (pass `null` when reading from stdin). |
| `content`    | `string`                                          | Raw file content to import.                                                       |
| `manifest`   | [`ClefManifest`](../interfaces/ClefManifest.md)   | Parsed manifest.                                                                  |
| `repoRoot`   | `string`                                          | Absolute path to the repository root.                                             |
| `options`    | [`ImportOptions`](../interfaces/ImportOptions.md) | Import options (format, prefix, key filter, overwrite, dry-run).                  |

#### Returns

`Promise`\<[`ImportResult`](../interfaces/ImportResult.md)\>
