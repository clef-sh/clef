[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ConsumptionClient

# Class: ConsumptionClient

Defined in: [packages/core/src/consumption/client.ts:12](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/consumption/client.ts#L12)

Prepares decrypted secrets for consumption via environment injection or shell export.

## Example

```ts
const client = new ConsumptionClient();
const env = client.prepareEnvironment(decrypted, process.env, { prefix: "APP_" });
```

## Constructors

### Constructor

```ts
new ConsumptionClient(): ConsumptionClient;
```

#### Returns

`ConsumptionClient`

## Methods

### formatExport()

```ts
formatExport(
   decryptedFile,
   format,
   noExport): string;
```

Defined in: [packages/core/src/consumption/client.ts:58](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/consumption/client.ts#L58)

Formats decrypted values for stdout output.
Values are single-quoted; embedded single quotes are escaped as '\''.

#### Parameters

| Parameter       | Type                                              |
| --------------- | ------------------------------------------------- |
| `decryptedFile` | [`DecryptedFile`](../interfaces/DecryptedFile.md) |
| `format`        | `"env"`                                           |
| `noExport`      | `boolean`                                         |

#### Returns

`string`

---

### prepareEnvironment()

```ts
prepareEnvironment(
   decryptedFile,
   baseEnv,
options?): Record<string, string>;
```

Defined in: [packages/core/src/consumption/client.ts:17](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/consumption/client.ts#L17)

Merges decrypted values into a base environment, respecting --only, --prefix, and --no-override.
Returns a new environment record suitable for child_process.spawn.

#### Parameters

| Parameter       | Type                                              |
| --------------- | ------------------------------------------------- |
| `decryptedFile` | [`DecryptedFile`](../interfaces/DecryptedFile.md) |
| `baseEnv`       | `Record`\<`string`, `string` \| `undefined`\>     |
| `options`       | [`ExecOptions`](../interfaces/ExecOptions.md)     |

#### Returns

`Record`\<`string`, `string`\>
