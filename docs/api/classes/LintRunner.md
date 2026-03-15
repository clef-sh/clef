[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / LintRunner

# Class: LintRunner

Defined in: [packages/core/src/lint/runner.ts:23](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/lint/runner.ts#L23)

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

Defined in: [packages/core/src/lint/runner.ts:24](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/lint/runner.ts#L24)

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

Defined in: [packages/core/src/lint/runner.ts:344](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/lint/runner.ts#L344)

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

Defined in: [packages/core/src/lint/runner.ts:37](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/lint/runner.ts#L37)

Lint the entire matrix: check missing files, schema errors, SOPS integrity,
single-recipient warnings, and cross-environment key drift.

#### Parameters

| Parameter  | Type                                            | Description                           |
| ---------- | ----------------------------------------------- | ------------------------------------- |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                      |
| `repoRoot` | `string`                                        | Absolute path to the repository root. |

#### Returns

`Promise`\<[`LintResult`](../interfaces/LintResult.md)\>
