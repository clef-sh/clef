[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / SchemaValidator

# Class: SchemaValidator

Defined in: [packages/core/src/schema/validator.ts:21](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/schema/validator.ts#L21)

Loads namespace schemas and validates decrypted key/value maps against them.

## Example

```ts
const validator = new SchemaValidator();
const schema = validator.loadSchema("schemas/app.yaml");
const result = validator.validate(decrypted.values, schema);
```

## Constructors

### Constructor

```ts
new SchemaValidator(): SchemaValidator;
```

#### Returns

`SchemaValidator`

## Methods

### loadSchema()

```ts
loadSchema(filePath): NamespaceSchema;
```

Defined in: [packages/core/src/schema/validator.ts:29](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/schema/validator.ts#L29)

Read and parse a YAML schema file from disk.

#### Parameters

| Parameter  | Type     | Description                   |
| ---------- | -------- | ----------------------------- |
| `filePath` | `string` | Path to the schema YAML file. |

#### Returns

[`NamespaceSchema`](../interfaces/NamespaceSchema.md)

Parsed [NamespaceSchema](../interfaces/NamespaceSchema.md).

#### Throws

[SchemaLoadError](SchemaLoadError.md) If the file cannot be read or contains invalid YAML.

---

### validate()

```ts
validate(values, schema): ValidationResult;
```

Defined in: [packages/core/src/schema/validator.ts:99](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/schema/validator.ts#L99)

Validate a set of decrypted values against a loaded namespace schema.

#### Parameters

| Parameter | Type                                                  | Description                                    |
| --------- | ----------------------------------------------------- | ---------------------------------------------- |
| `values`  | `Record`\<`string`, `string`\>                        | Flat key/value map from a decrypted SOPS file. |
| `schema`  | [`NamespaceSchema`](../interfaces/NamespaceSchema.md) | Schema loaded via [loadSchema](#loadschema).   |

#### Returns

[`ValidationResult`](../interfaces/ValidationResult.md)

[ValidationResult](../interfaces/ValidationResult.md) with `valid: false` when any errors are present.
