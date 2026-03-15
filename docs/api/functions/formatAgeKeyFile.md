[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / formatAgeKeyFile

# Function: formatAgeKeyFile()

```ts
function formatAgeKeyFile(privateKey, publicKey): string;
```

Defined in: [packages/core/src/age/keygen.ts:42](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/age/keygen.ts#L42)

Format an age private key and public key into the standard key file format.
The output includes a `created` timestamp comment and is ready to write to disk.

## Parameters

| Parameter    | Type     | Description                                       |
| ------------ | -------- | ------------------------------------------------- |
| `privateKey` | `string` | `AGE-SECRET-KEY-1...` armored private key string. |
| `publicKey`  | `string` | `age1...` bech32 public key string.               |

## Returns

`string`
