# Embed KMS-wrapped age private key in bundles

## Context

Currently, `clef bundle` generates a JS module containing an age-encrypted blob of secrets. At runtime, the user's `keyProvider` function fetches the **plaintext** age private key from a secrets manager and passes it to `getSecret()`. This requires storing a plaintext cryptographic key in a secrets manager — a service designed for application secrets, not key management.

The change follows standard **envelope encryption**: the age private key (DEK) is wrapped by a cloud KMS key (KEK, never leaves KMS), and the wrapped form is embedded directly in the bundle. At runtime, the workload calls KMS to unwrap the key in memory, then uses it to decrypt the blob. No plaintext key is ever stored at rest.

**Important limitation to document:** Bundles are snapshots — rotation of the service identity key (or any secret change) always requires regenerating the bundle and redeploying. This is inherent to the bundled approach, not introduced by this change.

## Approach

Add an optional `--wrapped-key <file>` flag to `clef bundle`. When provided, the file content is embedded as a `WRAPPED_KEY` constant in the generated JS module. The `keyProvider` signature does **not** change — users update their keyProvider to unwrap the embedded key via KMS instead of fetching from a secrets manager. Fully backward compatible.

## Files to modify

### 1. `packages/core/src/types/index.ts` — add optional field to BundleConfig

```typescript
export interface BundleConfig {
  identity: string;
  environment: string;
  outputPath: string;
  format: "esm" | "cjs";
  wrappedKey?: string; // KMS-wrapped age private key to embed
}
```

### 2. `packages/core/src/bundle/runtime.ts` — emit WRAPPED_KEY conditionally

- Add fourth parameter: `wrappedKey?: string`
- Apply same escaping as ciphertext (backslash, backtick, dollar sign)
- ESM: insert `export const WRAPPED_KEY = \`...\`;` after CIPHERTEXT when present
- CJS: insert `const WRAPPED_KEY = \`...\`;`and add to`module.exports`
- When absent: output is identical to today (no WRAPPED_KEY at all)

### 3. `packages/core/src/bundle/generator.ts` — one-line passthrough

Line 101: pass `config.wrappedKey` as fourth arg to `generateRuntimeModule`.

### 4. `packages/cli/src/commands/bundle.ts` — read file, pass to config

- Add `.option("--wrapped-key <path>", "Path to a KMS-wrapped age private key to embed in the bundle")`
- Read file early (before decrypt/encrypt), validate non-empty
- Error and exit if file doesn't exist or is empty
- Pass `wrappedKey` into `BundleConfig`
- Print `Wrapped key: embedded` in output when used

### 5. Tests

**`packages/core/src/bundle/runtime.test.ts`** — new describe block:

- No WRAPPED_KEY when param omitted (ESM + CJS)
- WRAPPED_KEY present and exported when provided (ESM + CJS)
- Special characters escaped in wrappedKey

**`packages/core/src/bundle/generator.test.ts`** — two new tests:

- wrappedKey passes through to generated source
- No WRAPPED_KEY when wrappedKey not in config

**`packages/cli/src/commands/bundle.test.ts`** — three new tests:

- --wrapped-key embeds key in output
- --wrapped-key with nonexistent file errors
- No WRAPPED_KEY when flag absent

### 6. `docs/guide/service-identities.md` — significant updates

- **Mermaid diagram**: add KMS wrapping step and show WRAPPED_KEY in bundle
- **How it works list**: add wrapping as alternative to secrets manager storage
- **Generating bundles**: add `--wrapped-key` usage example
- **Generated module API**: add `WRAPPED_KEY` to TypeScript signatures
- **AWS Lambda walkthrough**: add "3b. Alternative: Wrap with KMS" subsection with `aws kms encrypt` commands, IAM policy (`kms:Decrypt`), and handler using `KMSClient`/`DecryptCommand`
- **Key providers**: add envelope encryption variants for GCP (Cloud KMS) and Azure (Key Vault)
- **Security model**: update "What the bundle contains" bullets, trust boundaries table, add envelope encryption paragraph
- **New section or callout**: document the redeploy-on-rotation limitation explicitly as a property of the bundled approach (applies to secret changes and key rotation alike)

## Verification

```bash
npm run lint
npm run test:coverage
npm run format:check
cd docs && npm run build
```
