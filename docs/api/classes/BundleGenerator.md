[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / BundleGenerator

# Class: BundleGenerator

Defined in: packages/core/src/bundle/generator.ts:20

Generates runtime JS bundles for service identities.

Decrypts scoped SOPS files, age-encrypts all values as a single blob
to the service identity's per-env public key, and generates a JS module
that uses `age-encryption` to decrypt at runtime.

## Example

```ts
const generator = new BundleGenerator(sopsClient, matrixManager);
const result = await generator.generate(config, manifest, repoRoot);
```

## Constructors

### Constructor

```ts
new BundleGenerator(encryption, matrixManager): BundleGenerator;
```

Defined in: packages/core/src/bundle/generator.ts:21

#### Parameters

| Parameter       | Type                                                      |
| --------------- | --------------------------------------------------------- |
| `encryption`    | [`EncryptionBackend`](../interfaces/EncryptionBackend.md) |
| `matrixManager` | [`MatrixManager`](MatrixManager.md)                       |

#### Returns

`BundleGenerator`

## Methods

### generate()

```ts
generate(
   config,
   manifest,
repoRoot): Promise<BundleResult>;
```

Defined in: packages/core/src/bundle/generator.ts:33

Generate a runtime bundle for a service identity + environment.

#### Parameters

| Parameter  | Type                                            | Description                                                        |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `config`   | [`BundleConfig`](../interfaces/BundleConfig.md) | Bundle configuration (identity, environment, output path, format). |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest.                                                   |
| `repoRoot` | `string`                                        | Absolute path to the repository root.                              |

#### Returns

`Promise`\<[`BundleResult`](../interfaces/BundleResult.md)\>
