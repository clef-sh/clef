[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / resolveBackendConfig

# Function: resolveBackendConfig()

```ts
function resolveBackendConfig(manifest, environment): EnvironmentSopsOverride;
```

Defined in: [packages/core/src/types/index.ts:67](https://github.com/clef-sh/clef/blob/9d2f6385a699079e36207595d20c8223e8f8f5c8/packages/core/src/types/index.ts#L67)

Resolve the effective backend configuration for an environment.
Returns the per-env override if present, otherwise falls back to the global `sops` config.

## Parameters

| Parameter     | Type                                            |
| ------------- | ----------------------------------------------- |
| `manifest`    | [`ClefManifest`](../interfaces/ClefManifest.md) |
| `environment` | `string`                                        |

## Returns

[`EnvironmentSopsOverride`](../interfaces/EnvironmentSopsOverride.md)
