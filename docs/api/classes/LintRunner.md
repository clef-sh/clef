[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / LintRunner

# Class: LintRunner

Defined in: [packages/core/src/lint/runner.ts:17](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/lint/runner.ts#L17)

Runs matrix completeness, schema validation, SOPS integrity, and key-drift checks.

## Example

```ts
const runner = new LintRunner(matrixManager, schemaValidator, sopsClient);
const result = await runner.run(manifest, repoRoot);
```

## Constructors

### Constructor

```ts
new LintRunner(
   matrixManager,
   schemaValidator,
   sopsClient): LintRunner;
```

Defined in: [packages/core/src/lint/runner.ts:18](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/lint/runner.ts#L18)

#### Parameters

| Parameter         | Type                                                      |
| ----------------- | --------------------------------------------------------- |
| `matrixManager`   | [`MatrixManager`](MatrixManager.md)                       |
| `schemaValidator` | [`SchemaValidator`](SchemaValidator.md)                   |
| `sopsClient`      | [`EncryptionBackend`](../interfaces/EncryptionBackend.md) |

#### Returns

`LintRunner`

## Methods

### fix()

```ts
fix(manifest, repoRoot): Promise<LintResult>;
```

Defined in: [packages/core/src/lint/runner.ts:247](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/lint/runner.ts#L247)

Auto-fix safe issues (scaffold missing matrix files), then re-run lint.

#### Parameters

| Parameter  | Type                                            | Description                           |
| ---------- | ----------------------------------------------- | ------------------------------------- |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                      |
| `repoRoot` | `string`                                        | Absolute path to the repository root. |

#### Returns

`Promise`\<[`LintResult`](../interfaces/LintResult.md)\>

---

### run()

```ts
run(manifest, repoRoot): Promise<LintResult>;
```

Defined in: [packages/core/src/lint/runner.ts:31](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/lint/runner.ts#L31)

Lint the entire matrix: check missing files, schema errors, SOPS integrity,
single-recipient warnings, and cross-environment key drift.

#### Parameters

| Parameter  | Type                                            | Description                           |
| ---------- | ----------------------------------------------- | ------------------------------------- |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                      |
| `repoRoot` | `string`                                        | Absolute path to the repository root. |

#### Returns

`Promise`\<[`LintResult`](../interfaces/LintResult.md)\>
