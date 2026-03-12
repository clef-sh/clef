[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / isHighEntropy

# Function: isHighEntropy()

```ts
function isHighEntropy(value, threshold?, minLength?): boolean;
```

Defined in: [packages/core/src/scanner/patterns.ts:68](https://github.com/clef-sh/clef/blob/bd250a27e006f10052d1b448652243e22e4e47a2/packages/core/src/scanner/patterns.ts#L68)

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
