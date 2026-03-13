[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / resolveRecipientsForEnvironment

# Function: resolveRecipientsForEnvironment()

```ts
function resolveRecipientsForEnvironment(
  manifest,
  environment,
):
  | (
      | string
      | {
          key: string;
          label?: string;
        }
    )[]
  | undefined;
```

Defined in: [packages/core/src/types/index.ts:86](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L86)

Resolve per-environment recipients if defined.
Returns the environment's `recipients` array if non-empty, otherwise `undefined`
(caller should fall back to global recipients).

## Parameters

| Parameter     | Type                                            |
| ------------- | ----------------------------------------------- |
| `manifest`    | [`ClefManifest`](../interfaces/ClefManifest.md) |
| `environment` | `string`                                        |

## Returns

\| (
\| `string`
\| \{
`key`: `string`;
`label?`: `string`;
\})[]
\| `undefined`
