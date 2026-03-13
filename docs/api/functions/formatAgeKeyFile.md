[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / formatAgeKeyFile

# Function: formatAgeKeyFile()

```ts
function formatAgeKeyFile(privateKey, publicKey): string;
```

Defined in: [packages/core/src/age/keygen.ts:33](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/age/keygen.ts#L33)

Format an age private key and public key into the standard key file format.
The output includes a `created` timestamp comment and is ready to write to disk.

## Parameters

| Parameter    | Type     | Description                                       |
| ------------ | -------- | ------------------------------------------------- |
| `privateKey` | `string` | `AGE-SECRET-KEY-1...` armored private key string. |
| `publicKey`  | `string` | `age1...` bech32 public key string.               |

## Returns

`string`
