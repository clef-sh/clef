[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ScanRunner

# Class: ScanRunner

Defined in: [packages/core/src/scanner/index.ts:40](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/scanner/index.ts#L40)

Scans repository files for plaintext secrets using pattern matching and entropy detection.

## Example

```ts
const scanner = new ScanRunner(runner);
const result = await scanner.scan(repoRoot, manifest, { stagedOnly: true });
```

## Constructors

### Constructor

```ts
new ScanRunner(runner): ScanRunner;
```

Defined in: [packages/core/src/scanner/index.ts:41](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/scanner/index.ts#L41)

#### Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `runner`  | [`SubprocessRunner`](../interfaces/SubprocessRunner.md) |

#### Returns

`ScanRunner`

## Methods

### scan()

```ts
scan(
   repoRoot,
   manifest,
options?): Promise<ScanResult>;
```

Defined in: [packages/core/src/scanner/index.ts:52](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/scanner/index.ts#L52)

Scan tracked (or staged) files for secret-like values and unencrypted matrix files.

The scan respects `.clefignore` rules and inline `# clef-ignore` suppressions.

#### Parameters

| Parameter  | Type                                            | Description                                         |
| ---------- | ----------------------------------------------- | --------------------------------------------------- |
| `repoRoot` | `string`                                        | Absolute path to the repository root.               |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) | Parsed manifest used to identify matrix file paths. |
| `options`  | [`ScanOptions`](../interfaces/ScanOptions.md)   | Optional scan filters.                              |

#### Returns

`Promise`\<[`ScanResult`](../interfaces/ScanResult.md)\>
