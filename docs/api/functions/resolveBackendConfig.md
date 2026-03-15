[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / resolveBackendConfig

# Function: resolveBackendConfig()

```ts
function resolveBackendConfig(manifest, environment): EnvironmentSopsOverride;
```

Defined in: [packages/core/src/types/index.ts:68](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/types/index.ts#L68)

Resolve the effective backend configuration for an environment.
Returns the per-env override if present, otherwise falls back to the global `sops` config.

## Parameters

| Parameter     | Type                                            |
| ------------- | ----------------------------------------------- |
| `manifest`    | [`ClefManifest`](../interfaces/ClefManifest.md) |
| `environment` | `string`                                        |

## Returns

[`EnvironmentSopsOverride`](../interfaces/EnvironmentSopsOverride.md)
