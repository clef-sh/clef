[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / resolveSopsPath

# Function: resolveSopsPath()

```ts
function resolveSopsPath(): SopsResolution;
```

Defined in: [packages/core/src/sops/resolver.ts:71](https://github.com/clef-sh/clef/blob/71f300181effde6f6153e0e2220b808935f465e1/packages/core/src/sops/resolver.ts#L71)

Resolve the sops binary path.

Resolution order:

1. `CLEF_SOPS_PATH` env var — explicit override, used as-is
2. Bundled `@clef-sh/sops-{platform}-{arch}` package
3. System PATH fallback — returns bare `"sops"`

The result is cached module-wide. Call [resetSopsResolution](resetSopsResolution.md) in tests
to clear the cache.

## Returns

[`SopsResolution`](../interfaces/SopsResolution.md)
