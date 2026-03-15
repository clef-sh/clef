[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / generateRuntimeModule

# Function: generateRuntimeModule()

```ts
function generateRuntimeModule(armoredCiphertext, keys, format): string;
```

Defined in: packages/core/src/bundle/runtime.ts:15

Generate the JS source code for a runtime secrets module.

## Parameters

| Parameter           | Type               | Description                                                           |
| ------------------- | ------------------ | --------------------------------------------------------------------- |
| `armoredCiphertext` | `string`           | PEM-armored age ciphertext containing the encrypted JSON blob.        |
| `keys`              | `string`[]         | List of secret key names available in the bundle (for introspection). |
| `format`            | `"esm"` \| `"cjs"` | Output module format: "esm" or "cjs".                                 |

## Returns

`string`
