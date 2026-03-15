[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ManifestParser

# Class: ManifestParser

Defined in: [packages/core/src/manifest/parser.ts:50](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/manifest/parser.ts#L50)

Parses and validates `clef.yaml` manifest files.

## Example

```ts
const parser = new ManifestParser();
const manifest = parser.parse("/path/to/clef.yaml");
```

## Constructors

### Constructor

```ts
new ManifestParser(): ManifestParser;
```

#### Returns

`ManifestParser`

## Methods

### parse()

```ts
parse(filePath): ClefManifest;
```

Defined in: [packages/core/src/manifest/parser.ts:59](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/manifest/parser.ts#L59)

Read and validate a `clef.yaml` file from disk.

#### Parameters

| Parameter  | Type     | Description                                     |
| ---------- | -------- | ----------------------------------------------- |
| `filePath` | `string` | Absolute or relative path to the manifest file. |

#### Returns

[`ClefManifest`](../interfaces/ClefManifest.md)

Validated [ClefManifest](../interfaces/ClefManifest.md).

#### Throws

[ManifestValidationError](ManifestValidationError.md) If the file cannot be read, contains invalid YAML,
or fails schema validation.

---

### validate()

```ts
validate(input): ClefManifest;
```

Defined in: [packages/core/src/manifest/parser.ts:88](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/manifest/parser.ts#L88)

Validate an already-parsed object against the manifest schema.

#### Parameters

| Parameter | Type      | Description                         |
| --------- | --------- | ----------------------------------- |
| `input`   | `unknown` | Raw value returned by `YAML.parse`. |

#### Returns

[`ClefManifest`](../interfaces/ClefManifest.md)

Validated [ClefManifest](../interfaces/ClefManifest.md).

#### Throws

[ManifestValidationError](ManifestValidationError.md) On any schema violation.

---

### watch()

```ts
watch(filePath, onChange): () => void;
```

Defined in: [packages/core/src/manifest/parser.ts:556](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/manifest/parser.ts#L556)

Watch a manifest file for changes and invoke a callback on each successful parse.

#### Parameters

| Parameter  | Type                   | Description                                                 |
| ---------- | ---------------------- | ----------------------------------------------------------- |
| `filePath` | `string`               | Path to the manifest file to watch.                         |
| `onChange` | (`manifest`) => `void` | Called with the newly parsed manifest on each valid change. |

#### Returns

Unsubscribe function — call it to stop watching.

```ts
(): void;
```

##### Returns

`void`
