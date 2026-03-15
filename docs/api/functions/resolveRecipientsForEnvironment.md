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

Defined in: [packages/core/src/types/index.ts:87](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L87)

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
