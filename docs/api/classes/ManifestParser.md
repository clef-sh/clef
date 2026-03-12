[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ManifestParser

# Class: ManifestParser

Defined in: [packages/core/src/manifest/parser.ts:37](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/manifest/parser.ts#L37)

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

Defined in: [packages/core/src/manifest/parser.ts:46](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/manifest/parser.ts#L46)

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

Defined in: [packages/core/src/manifest/parser.ts:75](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/manifest/parser.ts#L75)

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

Defined in: [packages/core/src/manifest/parser.ts:263](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/manifest/parser.ts#L263)

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
