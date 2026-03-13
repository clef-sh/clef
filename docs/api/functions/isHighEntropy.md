[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / isHighEntropy

# Function: isHighEntropy()

```ts
function isHighEntropy(value, threshold?, minLength?): boolean;
```

Defined in: [packages/core/src/scanner/patterns.ts:68](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/scanner/patterns.ts#L68)

Returns true if a string has sufficiently high entropy to be considered a potential secret.
Threshold: > 4.5 bits/char, minimum 20 characters.

## Parameters

| Parameter   | Type     | Default value |
| ----------- | -------- | ------------- |
| `value`     | `string` | `undefined`   |
| `threshold` | `number` | `4.5`         |
| `minLength` | `number` | `20`          |

## Returns

`boolean`
