# Clef — Codebase Review

You are a senior security-focused software engineer conducting
a post-build review of the Clef codebase. You did not write
this code. Approach it with fresh eyes and appropriate
scepticism.

Read `clef-master-brief.md` first to understand the full
specification. Then run:

```bash
find . -name "*.ts" -not -path "*/node_modules/*" \
       -not -path "*/dist/*" \
  | sort
```

Use this to map the full file tree before reviewing anything.
Read every file referenced in each section below before
forming a judgement on that section. Do not rely on memory
of having seen a file — re-read it.

---

## How to work

- Read before you judge. Every section says which files to
  read. Read them.
- Only report problems. Do not summarise what the code does
  correctly. A section with no output means it passed.
- Assign a severity to every issue:
  - **Critical** — security vulnerability or data loss risk
  - **High** — functional defect, broken feature
  - **Medium** — spec deviation, missing behaviour
  - **Low** — quality issue, inaccuracy, minor omission
- For every issue include: file path, line reference if
  possible, description of the problem, and the exact
  change needed to fix it.
- At the end produce a single prioritised fix list —
  Critical first, then High, Medium, Low.

---

## 1. Security Audit

### 1.1 SopsClient — plaintext never touches disk

Read in full:

- `packages/core/src/sops/client.ts`
- The SOPS PDF (attached) — verify the subprocess invocation
  matches documented SOPS behaviour

Check:

- Every code path through `decrypt()` — confirm decrypted
  values flow through stdin/stdout only, never through a
  temp file
- Every code path through `encrypt()` — same check
- Every code path through `reEncrypt()` — same check
- If any temp file is created for any reason, confirm it is
  deleted in a `finally` block and that the deletion is
  tested
- Error paths — if SOPS returns a non-zero exit code, confirm
  the error message does not contain any decrypted value
- Confirm `assertSops()` is called before every operation
  that invokes the SOPS binary

### 1.2 UI server binding and authentication

Read:

- `packages/ui/src/server/index.ts`
- `packages/ui/src/server/auth.test.ts`
- `integration/tests/server-binding.test.ts`

Check:

- The server binds to `127.0.0.1` explicitly — not
  `0.0.0.0`, not `localhost` (which can resolve to `::` on
  some systems), not an unspecified address
- The integration test actually attempts a connection on
  a non-loopback address and asserts it fails — not just
  that the address field says `127.0.0.1`
- No middleware or configuration could override the binding
- Host header validation rejects requests where Host is not
  `127.0.0.1` — returns 403
- Bearer token authentication is required on all `/api`
  routes — token is 64 hex characters (256 bits entropy)
- Missing token returns 401, wrong token returns 401

### 1.3 Plaintext in logs and error messages

Read:

- `packages/core/src/sops/client.ts`
- `packages/cli/src/output/formatter.ts`
- `packages/cli/src/commands/set.ts`
- `packages/cli/src/commands/exec.ts`
- `packages/cli/src/commands/merge-driver.ts`
- `packages/cli/src/commands/service.ts`
- `packages/cli/src/commands/pack.ts`
- `packages/cli/src/commands/export.ts`
- `packages/cli/src/commands/import.ts`
- `packages/core/src/service-identity/manager.ts`
- `packages/core/src/artifact/packer.ts`
- `packages/ui/src/server/api.ts`

Check:

- No `console.log` or `console.error` anywhere that could
  include a decrypted value
- `clef set` confirmation message does not echo the value —
  even in the success case
- `clef exec` error paths do not include any injected
  environment variable values in the error message
- API error responses do not include decrypted values
- Search for any `.toString()` calls on objects that might
  contain secret values
- `clef merge-driver` conflict output shows key names and
  plaintext values to stderr — confirm this is intentional
  (user needs values to resolve conflicts) and that error
  paths (e.g. decryption failure) do not leak values
- `clef service create` and `clef service rotate` print
  private keys to stdout intentionally — confirm error paths
  during key generation do not leak partial key material
- `clef pack` error paths do not include decrypted values
  from the secrets being packed — only key names and
  encrypted content references are safe to log
- `clef import` error paths do not echo the imported values
  back to the user — even when the format parse fails

### 1.4 `clef exec` security

Read:

- `packages/cli/src/commands/exec.ts`
- `packages/core/src/consumption/client.ts`

Check:

- Values are injected via environment object passed to
  `spawn`, never via shell interpolation or command string
  construction
- `ps aux` cannot reveal secret values — confirm spawn is
  used with `env` option, not shell: true
- Signal forwarding: SIGINT → 130, SIGTERM → 143 —
  confirm the exit code mapping is correct
- `--only` flag correctly filters keys — no extra keys leak
  into the child environment
- The `--` separator detection is robust — test that a
  command containing `--` in its arguments works correctly

### 1.5 `clef export` security

Read:

- `packages/cli/src/commands/export.ts`

Check:

- `--format dotenv` and `--format json` and `--format yaml`
  are all rejected with clear explanations — not just
  "unsupported format"
- `--output <file>` flag does not exist — if it does, that
  is a Critical issue
- The Linux `/proc/<pid>/environ` warning goes to stderr,
  not stdout — confirm `eval $(clef export ...)` is not
  corrupted by the warning
- Values are single-quoted correctly — a value containing
  a single quote is escaped as `'\''`

### 1.6 Pending values security

Read:

- `packages/core/src/pending/metadata.ts`
- `packages/ui/src/server/api.ts` — the `{ random: true }`
  handler specifically

Check:

- `.clef-meta.yaml` files contain only key names and
  timestamps — never the random placeholder values
  themselves
- `generateRandomValue()` uses `crypto.randomBytes(32)` —
  not `Math.random()`, not `uuid`, not any other source
- The random value is generated in the API handler
  server-side — not in the React client. Check the React
  component sends `{ random: true }` to the API, not a
  generated value
- `markPending` and the corresponding encrypt call are
  handled atomically — what happens if encrypt succeeds
  but `markPending` fails?

### 1.7 `clef doctor --fix`

Read:

- `packages/cli/src/commands/doctor.ts`

Check:

- `--fix` calls the init core library function directly —
  no `program.parseAsync`, no `execSync`, no `spawn`
- If a subprocess call of any kind is found in the --fix
  path, that is a High issue

### 1.8 Merge driver — plaintext handling

Read:

- `packages/cli/src/commands/merge-driver.ts`
- `packages/core/src/merge/driver.ts`

Check:

- Decryption of base/ours/theirs files uses SopsClient
  (stdin/stdout only) — no temp plaintext files created
- Re-encryption of merged result uses SopsClient — merged
  plaintext is never written to disk unencrypted
- If re-encryption fails, the error message does not
  include the merged plaintext values
- The three-way merge operates on in-memory key/value maps
  only — no intermediate files
- SOPS MAC is valid on the re-encrypted output — confirm
  SOPS verifies integrity on re-encryption

### 1.9 Service identity — private key handling

Read in full:

- `packages/core/src/service-identity/manager.ts`
- `packages/cli/src/commands/service.ts`
- `packages/core/src/age/keygen.ts`
- `packages/core/src/kms/types.ts`

Check — Key generation (age-only path):

- `generateAgeIdentity()` uses the `age-encryption` package
  (the `age-encryption` npm package) — not
  `crypto.randomBytes` directly, not any custom key derivation
- One keypair is generated **per environment** — confirm no key
  sharing across environments
- The secret key string is never assigned to any object that
  persists beyond the `create` or `rotate` function scope

Check — KMS envelope path:

- When `--kms-env` is provided, `create` does NOT call
  `generateAgeIdentity()` for those environments — no age
  keys generated, no private keys printed
- KMS config (`provider`, `keyId`) is stored in `clef.yaml`
  under the environment — no private key material stored
- `registerRecipients()` skips KMS-backed environments —
  confirm `isKmsEnvelope()` guard is checked before
  `addRecipient()` is called
- KMS-backed environments are skipped during `rotateKey()` —
  there is no persistent key to rotate

Check — Mutual exclusion:

- Each environment in `service_identities` must have exactly
  one of `recipient` (age public key) or `kms` (KMS config)
- Manifest parser rejects environments with both `recipient`
  and `kms` — confirm `ManifestValidationError` is thrown
- Manifest parser rejects environments with neither —
  confirm `ManifestValidationError` is thrown

Check — Private key output:

- `clef service create` prints private keys to stdout exactly
  once (age-only environments only) — confirm they are not
  written to any file, not stored in `clef.yaml`, not stored
  in `.clef-meta.yaml`, not stored in `.clef/config.yaml`
- The output includes a clear warning that keys are shown once
  and must be stored in a secret manager immediately
- After `create` returns, no in-memory reference to the private
  keys remains — they are not cached or logged
- `clef service show` displays only public keys (age1...) or
  KMS provider info — never secret keys. Confirm no code path
  in `show` accesses private key material
- `clef service list` displays truncated public key previews
  (age-only) or `KMS (provider)` labels (KMS) — confirm
  truncation uses `keyPreview()` or equivalent for age keys

Check — Key rotation:

- `clef service rotate` generates new keypairs and prints new
  private keys — same one-time output rules as `create`
- Old private keys are not referenced or displayed during
  rotation
- Old public keys are removed from SOPS recipient lists before
  new ones are added — confirm the remove-then-add ordering
  prevents a window where both old and new keys can decrypt
- Rotation of a single environment (`--environment`) does not
  affect other environments' keys
- KMS-backed environments are skipped during rotation — no
  error, just silently skipped

Check — Recipient registration security:

- `registerRecipients()` only adds the identity's public key
  to SOPS files within the identity's declared namespace scope
- KMS-backed environments are skipped — no recipient to
  register
- A service identity scoped to `[api]` must NOT have its
  recipient registered on `database/*.enc.yaml` files — any
  scope leakage is a Critical issue
- Recipient removal during rotation only removes the identity's
  own old key — not other recipients

### 1.10 Bundled sops binary — supply chain and resolution

Read in full:

- `packages/core/src/sops/resolver.ts`
- `packages/core/src/sops/resolver.test.ts`
- `packages/core/src/sops/client.ts` — constructor and
  `sopsCommand` usage
- `packages/core/src/dependencies/checker.ts` — sops
  resolution path in `checkDependency`
- `sops-version.json`
- `scripts/download-sops.mjs`
- `.github/workflows/publish-sops.yml`
- All `platforms/sops-*/package.json` files

Check — Supply chain integrity:

- `sops-version.json` contains SHA256 checksums for every
  platform binary. Verify the checksum format is a full
  64-character hex digest — not truncated, not base64
- `download-sops.mjs` computes SHA256 of the downloaded
  binary and compares against the checksum in
  `sops-version.json`. If they do not match, the script
  must `process.exit(1)` — not warn and continue
- The download URL is constructed from the version in
  `sops-version.json` — not from user input or environment
  variables. The URL must point to
  `github.com/getsops/sops/releases` exclusively
- The `publish-sops.yml` workflow verifies
  `sops-version.json` matches the workflow input before
  downloading — a mismatch must fail the workflow
- The `publish-sops.yml` workflow runs the downloaded
  binary (`sops --version`) to verify it is a real
  executable — not just a random file that passed checksum
- Platform packages are published with `--provenance` to
  enable npm audit trail

Check — Resolution order security:

- `resolveSopsPath()` checks `CLEF_SOPS_PATH` first —
  this is the explicit override and must take precedence
- The bundled package is resolved via `require.resolve()` —
  confirm the resolved path is within a `node_modules`
  directory. A path traversal or symlink attack that
  resolves outside `node_modules` would be a Critical issue
- The system PATH fallback returns bare `"sops"` — confirm
  this string is never interpolated into a shell command.
  It must be passed as the first argument to
  `SubprocessRunner.run()` which uses `execFile` (not
  `exec`)
- The resolution result is cached module-wide. Confirm
  `resetSopsResolution()` exists and is only called in test
  files — not in production code. A production call would
  allow resolution cache poisoning

Check — SopsClient integration:

- `SopsClient` constructor accepts optional `sopsPath` as
  the 4th parameter. When omitted, it calls
  `resolveSopsPath().path` — confirm this default is
  applied in the constructor, not lazily
- Every `this.runner.run(...)` call in SopsClient uses
  `this.sopsCommand` — search for any remaining hardcoded
  `"sops"` string passed to `runner.run()`. Any occurrence
  is a High issue (bundled binary would be bypassed)
- `assertSops(this.runner)` still works with the resolved
  path — confirm `checkDependency("sops", runner)` uses
  the resolved path, not a hardcoded `"sops"`

Check — Platform package correctness:

- Each platform `package.json` has correct `os` and `cpu`
  fields matching npm's platform filtering
- The `files` array includes only the binary and license —
  no extra files that could be a vector
- All packages use `"license": "MPL-2.0"` (sops is
  MPL-2.0, not MIT)
- Version in each platform `package.json` matches the
  version in `sops-version.json`
- The `@clef-sh/cli` `optionalDependencies` versions match
  the platform package versions exactly

Check — `CLEF_SOPS_PATH` validation:

- If `CLEF_SOPS_PATH` is set to a nonexistent path, the
  resolver returns it without checking — confirm
  `assertSops()` catches this at version-check time with a
  `SopsMissingError`, not a silent failure
- If `CLEF_SOPS_PATH` contains shell metacharacters or
  spaces, confirm the path is passed to `execFile` (which
  does not interpret shell syntax) — not to `exec`

### 1.11 Licence compliance — age-encryption author attribution

The `age-encryption` npm package is BSD 3-Clause licensed.
The licence does not require author attribution in
documentation or marketing materials, and the project must
not name the author of `age-encryption` or the `age` CLI
anywhere in the codebase. Referring to the author by name
or GitHub handle in docs, comments, README files, or UI
copy is not permitted.

Run:

```bash
grep -ri "filippo\|valsorda\|filosottile" \
  --include="*.ts" --include="*.md" --include="*.json" \
  --include="*.yaml" --include="*.yml" --include="*.vue" \
  --include="*.astro" --include="*.html" --include="*.css" \
  --include="*.mjs" .
```

Check:

- Zero matches. Any match is a Medium issue
- Links to the `age` tool should point to
  `https://age-encryption.org` (the project site) — not to
  the author's personal GitHub repository
- Comments in code (e.g. `keygen.ts`, `resolver.ts`) must
  not reference the author — describe the library by its
  package name only

### 1.12 Agent server — binding and authentication

Read:

- `packages/agent/src/server.ts`
- `packages/agent/src/config.ts`

Check:

- Server binds to `127.0.0.1` only — not `0.0.0.0`, not
  `localhost` (which may resolve to `::` on dual-stack systems)
- Bearer token is required on all `/v1/secrets` and `/v1/keys`
  routes — token is 64 hex characters (256 bits of entropy)
  when auto-generated
- `/v1/health` and `/v1/ready` are unauthenticated — health
  probes must not require a token
- Host header validation rejects any request where the Host is
  not the loopback address — returns 403
- Token comparison is timing-safe — not a naive `===` compare
- Missing token returns 401; wrong token returns 401; correct
  token returns 200

### 1.13 Runtime — plaintext never touches disk

Read:

- `packages/runtime/src/poller.ts`
- `packages/runtime/src/decrypt.ts`
- `packages/runtime/src/secrets-cache.ts`
- `packages/runtime/src/disk-cache.ts`
- `packages/runtime/src/kms/aws.ts`

Check:

- Fetched artifact ciphertext is decrypted in memory only —
  no temp file is created during decryption
- SHA256 of the fetched artifact is verified against the
  `ciphertextHash` field in the envelope before decryption
- When `verifyKey` is configured, signature verification
  occurs after the integrity check and before decryption —
  a failed signature must prevent decryption entirely, not
  just log a warning. See section 1.17 for full signing
  audit
- On decryption failure the error message does not contain any
  artifact contents — only a generic failure indication
- Cache swap is atomic — concurrent readers never see a
  partial or empty secrets map during a refresh
- On fetch failure the existing cache is preserved and
  continues serving (stale-serve is preferred to empty)
- `DiskCache` writes only the raw artifact JSON (already
  age-encrypted ciphertext) and metadata (SHA, timestamp) —
  never plaintext values. Confirm `disk-cache.ts` never
  receives or writes decrypted content

Check — KMS envelope encryption (AES-256-GCM):

- When the artifact has an `envelope` field, the poller calls
  `createKmsProvider()` and `kms.unwrap()` to recover the
  32-byte AES-256 data encryption key (DEK) — this happens
  in memory only
- The unwrapped DEK buffer is zeroed after use
  (`dek.fill(0)`) in a `finally` block — confirm the
  zeroing executes even when AES-GCM decryption fails
  (e.g. corrupted authTag). If the `fill(0)` is in
  `try` instead of `finally`, the DEK leaks on error
- AES-GCM decryption uses `iv` and `authTag` from the
  artifact's `envelope` — confirm these fields are
  validated as non-empty in `parseAndValidate` before
  any decryption attempt
- `crypto.createDecipheriv("aes-256-gcm", dek, iv)` with
  `decipher.setAuthTag(authTag)` — confirm the auth tag
  is set BEFORE `decipher.update()` / `decipher.final()`.
  Node.js requires `setAuthTag` before `final()` for GCM
- A corrupted `authTag` or `iv` must cause
  `decipher.final()` to throw — confirm the error
  propagates and emits `artifact.invalid` telemetry with
  reason `"decrypt"`, not `"kms_unwrap"`
- The KMS key ID comes from the artifact's `envelope.keyId`
  field — it is NOT configurable via env var or runtime
  config (the artifact is self-describing)
- KMS errors (AccessDenied, InvalidKeyId) propagate cleanly
  without leaking any key material in the error message
- `@aws-sdk/client-kms` is loaded dynamically via
  `require()` — failure to load produces a clear error
  message, not an unhandled crash
- The age-only path (no `envelope`) must still use
  `AgeDecryptor` with a static private key — confirm the
  two paths are fully separate (KMS path must NOT call
  `AgeDecryptor`, age path must NOT call `createDecipheriv`)

### 1.14 Runtime — VCS token and credential handling

Read:

- `packages/runtime/src/vcs/github.ts`
- `packages/runtime/src/vcs/gitlab.ts`
- `packages/runtime/src/vcs/bitbucket.ts`
- `packages/runtime/src/index.ts` — `ClefRuntime` constructor

Check:

- VCS tokens are passed only in HTTP headers — never in URL
  query parameters or logged in error messages
- GitHub: `Authorization: Bearer {token}` header
- GitLab: `PRIVATE-TOKEN: {token}` header
- Bitbucket: `Authorization: Bearer {token}` header
- On VCS API error (401, 403, 404) the error message includes
  the status code and path but NOT the token
- Age private key is resolved once in the `ClefRuntime`
  constructor — not re-read on every poll cycle
- No credential material appears in `ArtifactSource.describe()`
  output (used for logging)

### 1.15 Agent — Lambda Extension key handling

Read:

- `packages/agent/src/lifecycle/lambda-extension.ts`

Check:

- Age private key is read from env var or key file at startup
  only — it is not re-read on every Lambda invocation
- Auto-generated token uses `crypto.randomBytes` — not
  `Math.random`, not `uuid`
- No key material appears in Lambda log output or in error
  responses forwarded to the Lambda Extensions API
- SHUTDOWN event is handled — in-flight requests are drained
  before the process exits

### 1.16 Pack command — plaintext handling

Read:

- `packages/core/src/artifact/packer.ts`
- `packages/core/src/artifact/resolve.ts`
- `packages/cli/src/commands/pack.ts`

Check:

- Decryption of source secrets happens in memory — no temp
  plaintext file is created
- The value written to the output file is age-encrypted
  ciphertext — the output JSON must not contain any plaintext
  secret values
- If age encryption fails, the error message does not include
  any decrypted values from the secrets being packed
- `--output` is required — omitting it produces a clear error,
  not output to stdout (which would expose ciphertext in
  terminal history and shell logs)
- Encrypted artifact JSON contains only ciphertext, key names,
  and metadata — no plaintext values anywhere in the envelope

Check — Signing key handling:

- `--signing-key` value and `CLEF_SIGNING_KEY` env var must
  not appear in any CLI output, error message, or log line
- The signing key must not be written to the artifact JSON —
  only `signature` and `signatureAlgorithm` appear
- When `--signing-kms-key` is used, the KMS key ARN appears
  in the `Signed:` status line — this is fine (it is not a
  secret). But the KMS signature bytes must not be logged
  beyond the base64 encoding in the artifact

Check — KMS envelope path (AES-256-GCM):

- When `isKmsEnvelope(envConfig)` is true, the packer
  generates a 32-byte random DEK via `crypto.randomBytes(32)`
  and a 12-byte IV via `crypto.randomBytes(12)`, encrypts
  the secrets JSON with AES-256-GCM, and wraps the DEK with
  `kms.wrap()` — all in memory, no external dependency
- The plaintext DEK is zeroed with `dek.fill(0)` in a
  `finally` block — confirm zeroing happens even if
  `kms.wrap()` throws. If the `fill(0)` is after the
  `wrap` call without `finally`, a KMS failure leaks the
  DEK in memory
- The DEK is never written to the artifact in plaintext —
  only the KMS-wrapped form (`wrappedKey`) appears in the
  `envelope` field alongside `iv` and `authTag`
- The `iv` and `authTag` fields are stored in the artifact's
  `envelope` — confirm both are base64-encoded and present.
  Missing either field makes the artifact undecryptable
- The KMS path must NOT import or call `age-encryption` —
  it uses only Node's built-in `crypto` module. Confirm no
  `import("age-encryption")` occurs in the KMS branch
- If `KmsProvider` is not injected but the identity uses KMS,
  the packer throws a clear error — not a null dereference
- The CLI (`pack.ts`) dynamically imports `createKmsProvider`
  from `@clef-sh/runtime` only when the identity uses KMS —
  confirm the import is conditional, not top-level

### 1.16b Broker envelope — independent KMS encryption path

Read:

- `packages/broker/src/envelope.ts`
- `packages/broker/src/envelope.test.ts`

The broker package has its own `packEnvelope()` function that
independently produces KMS-encrypted artifacts. It mirrors the
core packer's KMS path but is a completely separate
implementation — a defect in one does not imply the same
defect in the other, and vice versa. Both must be reviewed.

Check:

- `packEnvelope` generates a 32-byte DEK and 12-byte IV via
  `crypto.randomBytes`, encrypts with AES-256-GCM, wraps the
  DEK with `kms.wrap()` — same scheme as the core packer
- The plaintext DEK is zeroed with `dek.fill(0)` after
  wrapping — confirm zeroing happens even if `kms.wrap()`
  throws
- The envelope contains `iv` and `authTag` (base64-encoded)
  alongside `wrappedKey`, `provider`, `keyId`, `algorithm`
- `KmsEnvelope` type has all six fields — if `iv`
  or `authTag` are missing, the runtime poller will reject
  the artifact at validation time
- The broker must NOT import or call `age-encryption` — it
  uses only Node's built-in `crypto` module
- A round-trip test exists: encrypt with captured DEK, then
  decrypt the artifact's ciphertext/iv/authTag to recover
  the original plaintext values
- Plaintext secret values do NOT appear in the output JSON

### 1.17 Artifact signing — provenance and verification

Read in full:

- `packages/core/src/artifact/signer.ts`
- `packages/core/src/artifact/packer.ts`
- `packages/runtime/src/signature.ts`
- `packages/runtime/src/poller.ts`
- `packages/cli/src/commands/pack.ts`
- `packages/runtime/src/kms/aws.ts`

This section covers the entire signing surface. Without
signing, the artifact store and transport layer are in the
trust boundary — anyone who can write to S3 or MITM the
fetch can replace the artifact. With signing, the trust
boundary reduces to git (who controls what gets packed)
and the CI runner (which holds the signing key). A defect
in any check below re-expands the boundary.

Check — Canonical payload consistency:

- `buildSigningPayload` exists in TWO independent files:
  `packages/core/src/artifact/signer.ts` (pack-time) and
  `packages/runtime/src/signature.ts` (verify-time). These
  are not shared — they must produce byte-identical output
  for the same artifact. Any divergence silently breaks
  verification or, worse, allows bypass
- Both implementations must use the same domain prefix
  (`clef-sig-v2`), same newline separator, same field
  ordering, and same key sorting (`[...keys].sort()`)
- Both must include all security-relevant fields: version,
  identity, environment, revision, packedAt,
  ciphertextHash, sorted keys, expiresAt, and all six
  envelope fields (provider, keyId, wrappedKey, algorithm,
  iv, authTag). The iv and authTag fields were added to
  prevent IV-swap denial-of-service attacks on signed
  KMS artifacts — if they are missing from the payload,
  an attacker can modify iv/authTag without invalidating
  the signature, causing decryption failure
- Missing optional fields must be represented as empty
  strings in both implementations — not `undefined`, not
  omitted. Omitting a field would shorten the payload and
  change the signature
- Write a test that constructs the same artifact object
  in both packages and asserts the payloads are identical.
  If this test does not exist, that is a Medium issue

Check — Algorithm derivation:

- `verifySignature` in `packages/runtime/src/signature.ts`
  must derive the verification algorithm from the public
  key's ASN.1 type (`keyObj.asymmetricKeyType`), NOT from
  the artifact's `signatureAlgorithm` field. The
  `signatureAlgorithm` field in the artifact is
  informational — an attacker controls it. If the runtime
  uses it to select the verification path, that is a
  Critical issue (algorithm downgrade attack)
- Ed25519 verification must use `crypto.verify(null, ...)`
  — passing a hash algorithm to Ed25519 is an error
- ECDSA verification must use `crypto.verify("sha256", ...)`
- Any key type other than `ed25519` or `ec` must throw —
  not silently return `false`

Check — Hard reject behaviour:

- When `options.verifyKey` is configured on the poller,
  an artifact WITHOUT a `signature` field must be rejected
  with a thrown error — not a warning, not a log, not a
  graceful fallback to unsigned mode. Any permissive
  handling is a Critical issue (the entire signing feature
  is defeated if unsigned artifacts are accepted)
- An artifact with an INVALID signature (wrong key, or
  tampered payload) must be rejected with a thrown error
- Both rejection paths must emit `artifact.invalid`
  telemetry with distinctive reason codes
  (`signature_missing`, `signature_invalid`) so ops teams
  can distinguish the attack vector from operational errors
- When `options.verifyKey` is NOT configured, unsigned
  artifacts must be accepted normally — signing is opt-in.
  If the absence of a verify key causes a crash or
  rejection, that is a High issue (breaks all existing
  deployments)

Check — Verify key provenance:

- The `verifyKey` must come from `PollerOptions` (injected
  at construction time from the deployment config), NOT
  from the artifact JSON. If the poller reads a public key
  from the fetched artifact and uses it for verification,
  that is a Critical issue — an attacker signs with their
  own key and embeds it in the artifact
- Trace the verify key from `RuntimeConfig.verifyKey`
  through to `ArtifactPoller` options and confirm it is
  the same value used in the `verifySignature` call — no
  overrides, no fallbacks to artifact fields
- Confirm `PackedArtifact` in the runtime does NOT have
  a `verifyKey` field that the poller reads — the verify
  key lives exclusively in config, never in the artifact

Check — Signing key handling:

- The Ed25519 signing private key arrives via
  `--signing-key` CLI flag or `CLEF_SIGNING_KEY` env var.
  It must NOT be read from the manifest (`clef.yaml`)
  because the manifest is in the git repo — the signing
  key is a CI secret, not a versioned config
- The signing private key must NOT appear in the artifact
  JSON — only the `signature` (output) and
  `signatureAlgorithm` (metadata) are written. Search the
  packer for any assignment of the signing key to the
  artifact object
- The CLI must NOT echo the signing key in its output. The
  `Signed: Ed25519` or `Signed: KMS ECDSA_SHA256` status
  line is fine; printing the key value is a Critical issue
- The signing private key must NOT be logged by any
  telemetry or error handler

Check — Mutual exclusion:

- Providing both `signingKey` (Ed25519) and
  `signingKmsKeyId` (KMS) must throw before any
  decryption occurs — not after secrets have been loaded
  into memory. Check that the guard is at the top of
  `ArtifactPacker.pack()`, before `resolveIdentitySecrets`
- The CLI must validate mutual exclusion before calling
  `packer.pack()` — double-guarding is acceptable

Check — Signing order:

- `expiresAt` must be set on the artifact BEFORE
  `buildSigningPayload` is called. If expiresAt is set
  after signing, the signature does not cover the TTL and
  an attacker who intercepts the artifact can extend its
  lifetime by modifying `expiresAt`. Verify the ordering
  in `packer.ts`: `expiresAt` assignment → signing block
- Confirm this ordering is tested — a test should sign
  with TTL and verify the signature covers the expiresAt
  value

Check — KMS signing specifics:

- `signKms` in `signer.ts` must pass a SHA-256 digest to
  `kms.sign()`, not the raw payload. AWS KMS `SignCommand`
  with `MessageType: "DIGEST"` expects a 32-byte digest.
  Passing the raw payload would produce incorrect signatures
  that only work with `MessageType: "RAW"` — which Clef
  does not use
- The AWS KMS provider's `sign()` method must use
  `SigningAlgorithm: "ECDSA_SHA_256"` and
  `MessageType: "DIGEST"` — not `"RAW"`, not
  `"RSASSA_PKCS1_V1_5_SHA_256"`
- The KMS signing key ARN (`signingKmsKeyId`) is a
  DIFFERENT key from the envelope wrapping key
  (`kms.keyId`). The signing key is asymmetric
  (ECC_NIST_P256); the envelope key is symmetric
  (SYMMETRIC_DEFAULT). Using the wrong key type will fail
  at the KMS API level, not silently — but confirm this
  distinction is documented. If `signingKmsKeyId` silently
  falls through to the envelope key, that is a High issue
- `kms.sign` is an optional method on `KmsProvider`. If
  the provider does not implement it, `signKms` must throw
  a clear error — not produce an undefined signature

Check — What signing does NOT protect against:

- A compromised CI runner has both the signing key and
  access to plaintext during pack. Signing does not
  protect against this — it protects against artifact
  store compromise and transport-layer attacks
- An insider with merge permissions can change the
  manifest to point to a different verify key, then sign
  artifacts with the corresponding private key. This is
  mitigated by CODEOWNERS and branch protection, not by
  signing itself
- The `ciphertextHash` is inside the signed payload, so
  ciphertext tampering is caught. But if the signing key
  is compromised, the attacker can produce valid artifacts
  with arbitrary content. Signing does not substitute for
  KMS envelope protection of the ciphertext

### 1.18 Install script — download integrity

Read:

- `www/public/install.sh`

Check:

- Clef binary SHA256 checksum is downloaded and verified
  before installation — using the `.sha256` file uploaded to
  the GitHub Release alongside each binary
- Sops binary SHA256 is verified against the official
  `checksums.txt` file published by getsops — not skipped,
  not hardcoded
- `curl` is called with `-fsSL` so any HTTP error status
  (including 404) causes a non-zero exit — not silent failure
- Temporary directory is cleaned up via `trap … EXIT` even
  when the script exits on error — no leftover files
- Downloaded content is never interpreted as shell code —
  only written to files and executed after chmod

### 1.19 Clef Cloud — opt-in invariants

Read in full:

- `packages/cloud/src/index.ts`
- `packages/cloud/src/cli.ts`
- `packages/cloud/src/commands/cloud.ts`
- `packages/cloud/src/keyservice.ts`
- `packages/cloud/src/resolver.ts`
- `packages/cloud/src/device-flow.ts`
- `packages/cloud/src/credentials.ts`
- `packages/cloud/src/token-refresh.ts`
- `packages/cloud/src/pack-client.ts`
- `packages/cloud/src/report-client.ts`

Clef Cloud ships in every CLI release but must be fully
inert until the user explicitly opts in (`clef cloud init`
/ `clef cloud login`). Any outbound network call from a
CLI that has never been opted in is a Critical issue.

Check — Inertness on an unconfigured install:

- A fresh CLI install with no `~/.clef/cloud-credentials.*`
  and no `clef cloud init` must make ZERO outbound HTTP
  requests on any command except the explicit `clef cloud
login` and `clef cloud init` commands
- No top-level `import` or `require` in `packages/cli` or
  `packages/core` may execute cloud HTTP clients at load
  time — all cloud code must be lazy-loaded behind an
  `isCloudConfigured()` check
- `keyservice` binary must NOT be spawned unless the
  manifest declares a `kms.provider: cloud` or the user
  explicitly runs a cloud command. A stray spawn on every
  CLI invocation is a Critical issue

Check — Device-flow login:

- Device-flow requests (`/oauth/device/code`, `/oauth/token`)
  use HTTPS only — no HTTP fallback
- The device code is displayed on stdout; the verification
  URL is shown in full. No code is auto-copied or auto-opened
  in a browser without user confirmation
- The refresh token and access token are written to
  `~/.clef/cloud-credentials.*` with mode `0600` — any
  mode more permissive than owner-only is a High issue
- Token refresh (`token-refresh.ts`) happens on 401 and
  retries the original request exactly once — no infinite
  retry loop
- Logout (`clef cloud logout` if present) deletes the
  credentials file and revokes the refresh token via API

Check — Keyservice binary handling:

- `keyservice` is resolved from the platform-specific
  `@clef-sh/keyservice-{platform}-{arch}` optional
  dependency package, not from PATH and not from a user-
  writable location
- The resolver validates the resolved path is inside a
  `node_modules` directory (same invariant as sops
  resolver — see section 1.10)
- `keyservice` spawn uses `execFile` with explicit argv —
  never `exec` or `shell: true`
- The gRPC socket path passed to keyservice is a process-
  local temp path that is cleaned up on exit (unix socket
  or named pipe)
- Keyservice stdout/stderr are captured and scrubbed before
  being surfaced to the user — no KMS key material, no
  Cloud access token should leak through

Check — Cloud KMS provider:

- When `kms.provider: cloud` is resolved in
  `packages/core/src/kms/`, the wrap/unwrap operations
  proxy through keyservice — not directly to AWS/GCP/Azure
  SDKs
- A failure to authenticate with Cloud must NOT fall back
  to unauthenticated SOPS operations — it must throw
- The Cloud KMS path must never write decrypted values to
  disk — same plaintext-never-touches-disk invariant as
  the local sops client

### 1.20 Broker package — dynamic credential exchange

Read:

- `packages/broker/src/config.ts`
- `packages/broker/src/validate.ts`
- `packages/broker/src/handler.ts`
- `packages/broker/src/serve.ts`
- `packages/broker/src/envelope.ts` (already covered by 1.16b)

Check:

- Broker configuration is loaded from YAML and validated
  against a strict schema — unknown fields are rejected,
  not silently ignored
- Broker handlers never log the broker's long-term
  credentials (e.g. IAM access keys, service account JSON)
  — only the short-lived output and the exchange metadata
  are safe to log
- `serve.ts` binds to a local socket or `127.0.0.1` only —
  never `0.0.0.0`
- The broker harness is not loaded or referenced from the
  CLI or core packages on a command that does not explicitly
  use it — same inertness principle as Clef Cloud

### 1.21 Client SDK — token handling

Read:

- `packages/client/src/clef-client.ts`
- `packages/client/src/auth.ts`
- `packages/client/src/http.ts`
- `packages/client/src/cloud-kms-provider.ts`

Check:

- The SDK falls back to environment variables when the
  remote secret fetch fails — documented behaviour, so
  confirm the fallback is behind an explicit option and
  emits telemetry
- Access tokens are sent only in `Authorization: Bearer`
  headers — never in URL query parameters
- Token refresh (if implemented) retries at most once per
  request and does not loop on a 401
- The SDK's `/kms` subpath does not embed any provider
  credentials in the SDK bundle — all credential material
  comes from the runtime environment

---

## 2. Correctness Audit

### 2.1 Exit codes

Read:

- `packages/cli/src/commands/diff.ts`
- `packages/cli/src/commands/lint.ts`
- `packages/cli/src/commands/exec.ts`
- `packages/cli/src/commands/export.ts`
- `packages/cli/src/commands/doctor.ts`
- `packages/cli/src/commands/update.ts`
- `packages/cli/src/commands/scan.ts`
- `packages/cli/src/commands/merge-driver.ts`

Check:

- `clef diff` exits 1 when differences exist, 0 when none —
  this makes it scriptable
- `clef lint` exits 1 on errors, 0 when only warnings or
  clean — warnings must not cause exit 1
- `clef exec` exits with the exact exit code of the child
  process — not 0 on child failure, not always 1
- `clef doctor` exits 1 if any check fails, 0 if all pass
- `clef update` exits 0 when all cells present or newly
  scaffolded, exits 1 on error
- `clef scan` exits 0 when no issues, 1 when issues found,
  2 on scan failure
- `clef merge-driver` exits 0 on clean merge (re-encrypted),
  1 on conflicts or errors
- All commands exit 1 on unexpected errors — no silent
  failures

### 2.2 `clef set` pending resolution

Read:

- `packages/cli/src/commands/set.ts`
- `packages/core/src/pending/metadata.ts`

Check:

- A normal `clef set` (without `--random`) on a pending key
  calls `markResolved` automatically
- A `clef set --random` on an already-pending key correctly
  updates the `since` timestamp in `.clef-meta.yaml`
- `clef set VALUE --random` (both value and flag) produces
  a clear error and does not proceed

### 2.3 Protected environment confirmation

Read:

- `packages/cli/src/commands/set.ts`
- `packages/cli/src/commands/delete.ts`
- `packages/cli/src/commands/rotate.ts`
- `packages/core/src/manifest/parser.ts`

Check:

- Every write operation on a `protected: true` environment
  prompts for confirmation — not just `clef set`
- `clef delete` on a protected environment requires
  confirmation
- `clef rotate` on a protected environment requires
  confirmation
- `clef exec` on a protected environment warns but does not
  block — exec is a read operation, not a write
- `clef set --random` on a protected environment also
  requires confirmation

### 2.4 `clef exec` exit code forwarding

Read:

- `packages/cli/src/commands/exec.ts`
- `integration/tests/exec-roundtrip.test.ts`
- `integration/tests/exec-signal.test.ts`

Check:

- The integration test actually runs a real child process
  that exits with a known code and asserts the parent exits
  with the same code
- Exit code 42 test exists and passes
- Exit code 0 test exists (success case)
- Signal exit codes: SIGINT → 130, SIGTERM → 143
- `exec-signal.test.ts` sends real SIGTERM and SIGINT to
  a running `clef exec` process and verifies the translated
  exit codes

### 2.5 `clef init --random-values` schema requirement

Read:

- `packages/cli/src/commands/init.ts`
- `docs/cli/init.md`

Check:

- Namespaces without a schema are skipped with a message
  pointing to `clef set --random`
- The docs clearly explain the four-step workflow:
  init → create schemas → reference in manifest →
  run --random-values
- Optional keys are skipped unless `--include-optional` is
  passed

### 2.6 Dependency version checks

Read:

- `packages/core/src/dependencies/checker.ts`
- `packages/core/src/sops/resolver.ts`

Check:

- Version string parsers match the exact format each binary
  outputs — sops, age, and git all output differently
- `checkAll()` uses `Promise.all` not sequential awaits
- `assertSops()` is called in SopsClient before every
  operation
- `assertAge()` is called when the manifest backend is age
- Missing binary returns null, does not throw
- `checkDependency("sops", ...)` uses `resolveSopsPath()`
  to determine the command — not a hardcoded `"sops"` string
- The resolved path is passed through to `DependencyVersion`
  via `source` and `resolvedPath` fields

### 2.7 Multi-namespace exec (`--also` flag)

Read:

- `packages/cli/src/commands/exec.ts`
- `packages/core/src/consumption/client.ts`

Check:

- Later `--also` entries override earlier ones for duplicate
  keys
- `--no-override` applies across all sources including
  `--also` entries
- A decryption failure on any `--also` source produces a
  clean error and no partial environment is injected into
  the child process

### 2.8 `--dir` flag

Read all command files in `packages/cli/src/commands/`.
Read `packages/cli/src/index.ts` — the global option
registration.

Check:

- `--dir` flag exists on every repo-scoped command (all 29
  listed in section 3.2, excluding `install` and `update`
  which operate on the CLI binary itself)
- It correctly overrides the auto-detected repo root in
  every command
- Tests cover `--dir` on at least three commands

### 2.9 Merge driver correctness

Read:

- `packages/cli/src/commands/merge-driver.ts`
- `packages/core/src/merge/driver.ts`
- `packages/core/src/merge/driver.test.ts`

Check:

- `clef merge-driver` accepts three positional arguments
  (`<base>`, `<ours>`, `<theirs>`) matching git's merge
  driver protocol (`%O`, `%A`, `%B`)
- Three-way merge algorithm correctly handles all scenarios:
  - Unchanged keys preserved
  - One-sided changes (ours only, theirs only) applied
  - Both sides changed to same value — take it
  - Both sides changed to different values — conflict
  - Key additions on one side applied
  - Key additions on both sides with same value — clean
  - Key additions on both sides with different values —
    conflict
  - Key deletions on one or both sides handled correctly
  - Delete vs. modify on same key — conflict
- Repo root detection walks up from file to find
  `clef.yaml` — handles invocation from git hooks
- Age key resolution follows same env/config pattern as
  other commands
- Re-encrypted output has valid SOPS MAC

### 2.10 Service identity correctness

Read:

- `packages/core/src/service-identity/manager.ts`
- `packages/cli/src/commands/service.ts`
- `packages/core/src/manifest/parser.ts`

Check — `clef service create` (age-only):

- Creating an identity with a namespace not in the manifest
  produces a clear error and does not modify `clef.yaml`
- Creating an identity with a duplicate name produces an
  error — not a silent overwrite
- The manifest is updated atomically — if recipient
  registration fails partway through, `clef.yaml` is not left
  in a half-updated state with some environments registered
  and others missing
- All declared environments get a keypair — if three
  environments exist (dev, staging, production), three
  keypairs are generated. Missing any one is a High issue

Check — `clef service create --kms-env`:

- `--kms-env` flag is parsed correctly: format is
  `env=provider:keyId`, repeatable
- KMS environments store `{ kms: { provider, keyId } }` in
  the manifest — no `recipient` field
- KMS environments do NOT call `generateAgeIdentity()` and
  do NOT print private keys
- Mixed mode works: some environments use `--kms-env`, others
  get age keys generated normally
- Invalid provider (not `aws`, `gcp`, `azure`) produces a
  clear error
- Invalid format (missing `=` or `:`) produces a clear error

Check — `clef service rotate`:

- `--environment` flag correctly targets a single environment
  — other environments' keys remain unchanged in the manifest
- Rotating all environments (no `--environment` flag) replaces
  every age-only key in the identity's `environments` map
- KMS-backed environments are skipped during rotation — no
  error, no key generated
- After rotation, the identity's recipient in all scoped
  SOPS files matches the new public key — confirm by checking
  that old recipient removal and new recipient addition both
  succeed or both fail (transactional)
- Rotating a nonexistent identity produces a clear error

Check — `clef service validate` / drift detection:

- `missing_environment` is detected when a new environment is
  added to the manifest but the identity has no key for it
- `namespace_not_found` is detected when a scoped namespace
  is removed from the manifest
- `recipient_not_registered` is detected when the identity's
  public key is missing from a SOPS file's recipient list
  within its scope
- `scope_mismatch` is detected when the identity's public key
  appears in a SOPS file outside its declared namespace scope
- KMS-backed environments skip recipient checks entirely —
  they have no recipient to check
- Each issue includes a `fixCommand` suggestion where
  applicable
- `clef lint` automatically runs service identity validation
  when `service_identities` is present in the manifest

Check — Protected environment interaction:

- `clef service create` on a manifest with `protected: true`
  environments — does it prompt for confirmation before
  modifying protected environment SOPS files?
- `clef service rotate` on a protected environment — does it
  require confirmation?

### 2.11 `clef update` correctness

Read:

- `packages/cli/src/commands/update.ts`
- `packages/cli/src/commands/update.test.ts`

Check:

- `clef update` identifies missing matrix cells
  (namespace × environment combinations without files)
- Each missing cell is scaffolded individually via
  `MatrixManager.scaffoldCell()`
- Partial scaffolding failures produce warnings but do not
  abort the entire operation
- Missing manifest produces a clear error and exit 1
- Age key file is read from `.clef/config.yaml` when
  present and no env vars override
- SOPS dependency errors are handled via
  `formatDependencyError()`
- Command is idempotent — running twice produces no changes
  on second run

### 2.12 Drift command correctness

Read:

- `packages/cli/src/commands/drift.ts`
- `packages/core/src/drift/detector.ts`

Check:

- Exits 0 when no drift is detected, exits 1 when drift
  exists — making it scriptable in CI
- `--json` output is machine-parseable and matches the
  `DriftResult` type from core
- Operates on encrypted YAML key names only — no decryption,
  no sops subprocess invoked at any point
- `--namespace` flag correctly limits comparison to the
  specified namespaces
- Comparing against a nonexistent path produces a clear error
  and exits 1
- Reports both missing keys and extra keys per namespace and
  per environment

### 2.13 Pack/artifact command correctness

Read:

- `packages/cli/src/commands/pack.ts`
- `packages/core/src/artifact/packer.ts`
- `packages/core/src/artifact/types.ts`

Check:

- Nonexistent identity produces a clear error and exits 1
- Nonexistent environment produces a clear error and exits 1
- Age-only: artifact encrypts to the identity's public key
  for the target environment — not to a developer key, not
  to a hardcoded recipient
- KMS envelope: artifact is encrypted with AES-256-GCM using
  a random 32-byte DEK; the DEK is wrapped by KMS and stored
  in the `envelope` field — confirm `envelope.wrappedKey`,
  `envelope.iv`, and `envelope.authTag` are all base64-encoded
  and `envelope.provider` and `envelope.keyId` match the
  manifest config. Confirm `envelope.iv` decodes to 12 bytes
  and `envelope.authTag` decodes to 16 bytes
- KMS envelope: `ArtifactPacker` requires a `KmsProvider` to
  be injected — missing it throws a clear error
- KMS envelope: the packer must NOT call `age-encryption` for
  KMS identities — only Node's built-in `crypto` module is
  used. The `age-encryption` dependency is only for age-only
  identities
- Artifact version is always `1` — the `envelope` field is
  optional and its presence determines age-only vs KMS
- Artifact envelope includes the revision so the agent can
  detect stale artifacts
- `--output` is required — omitting it produces a clear error
- Exits 0 on success, 1 on any error

Check — Signing correctness:

- `--signing-key` and `--signing-kms-key` are mutually
  exclusive — providing both produces a clear error before
  any decryption occurs
- `CLEF_SIGNING_KEY` env var is used when `--signing-key`
  flag is absent — confirm flag takes precedence
- `CLEF_SIGNING_KMS_KEY` env var is used when
  `--signing-kms-key` flag is absent
- When a signing key is provided, the artifact JSON contains
  `signature` (base64 string) and `signatureAlgorithm`
  (`"Ed25519"` or `"ECDSA_SHA256"`)
- When no signing key is provided, the artifact has no
  `signature` or `signatureAlgorithm` fields — backward
  compatible with pre-signing deployments
- `expiresAt` is set before signing — the signing payload
  must include the TTL. Check ordering in `packer.ts`
- Signed artifact with TTL: verify the signature is valid
  when verified with the matching public key (round-trip
  test exists)

### 2.14 Runtime — ClefRuntime correctness

Read:

- `packages/runtime/src/index.ts`
- `packages/runtime/src/poller.ts`
- `packages/runtime/src/sources/vcs.ts`
- `packages/runtime/src/sources/http.ts`
- `packages/runtime/src/sources/file.ts`

Check:

- `ClefRuntime` constructor validates that either VCS config
  (provider + repo + token + identity + environment) or a
  source URL/path is provided — missing both throws
- Age key resolution is wrapped in try/catch — it is optional
  for KMS envelope artifacts. Missing age key does NOT throw
  at construction time
- `resolveSource()` correctly routes to `VcsArtifactSource`,
  `HttpArtifactSource`, or `FileArtifactSource` based on
  config
- `start()` performs initial fetch+decrypt before returning —
  `get()` is not callable before `start()` completes
- `startPolling()` schedules adaptive polling (80% of `expiresAt` or `cacheTtl / 10`)
- `stopPolling()` clears the scheduled timer
- `init()` convenience function returns a ready runtime —
  `runtime.ready` is `true` after `init()` resolves
- Content-hash short-circuit: when the VCS SHA is unchanged,
  the poller skips parse+decrypt entirely — confirm this is
  tested
- Disk cache fallback: when VCS fetch fails and `cachePath`
  is set, the poller reads from disk cache — confirm this is
  tested
- Poller determines decrypt path by checking `artifact.envelope`
  presence — not a version number. If `envelope` is present,
  uses KMS unwrap + AES-256-GCM decrypt; otherwise uses
  static age private key with AgeDecryptor
- The two decrypt paths must be fully separate — the KMS path
  must never call `AgeDecryptor`, and the age path must never
  call `crypto.createDecipheriv`
- KMS path validates `envelope.iv` and `envelope.authTag` are
  present before attempting decryption — missing either is a
  validation error, not a runtime crash
- Age-only artifact without a private key configured throws
  a clear error at decrypt time — not a null dereference

### 2.15 Agent standalone correctness

Read:

- `packages/agent/src/main.ts`
- `packages/agent/src/config.ts`
- `packages/agent/src/lifecycle/daemon.ts`

Check:

- The agent is a standalone binary — not a CLI subcommand.
  Confirm `packages/cli/src/index.ts` does NOT import or
  register any agent command
- `resolveConfig()` validates VCS config: if any `VCS_*` var
  is set, all required ones must be present — partial config
  throws `ConfigError`
- Invalid `CLEF_AGENT_VCS_PROVIDER` (e.g. `"svn"`) throws
  `ConfigError`
- Either `CLEF_AGENT_SOURCE` or VCS config is required —
  neither produces a clear error
- Age key (`CLEF_AGENT_AGE_KEY` / `CLEF_AGENT_AGE_KEY_FILE`)
  is optional — not required for KMS envelope artifacts.
  Missing age key does NOT throw `ConfigError`
- `main.ts` wraps age key resolution in try/catch — failure
  is OK (KMS envelope artifacts don't need it)
- `main.ts` constructs the correct `ArtifactSource` based on
  VCS vs HTTP vs file config
- Poller performs initial fetch before the server starts —
  `/v1/ready` returns 503 until first successful decrypt
- On graceful shutdown the poller stops before the HTTP
  server closes, preventing new fetches during drain

---

## 3. Completeness Audit

### 3.1 Functional requirements cross-reference

Read `clef-master-brief.md` sections 3.1 through 3.11.
Cross-reference every requirement FR-01 through FR-54
against the implementation.

For each requirement state: Implemented / Partial /
Missing. Only report Partial and Missing items.

### 3.2 CLI completeness

Run:

```bash
find packages/cli/src/commands -name "*.ts" \
  -not -name "*.test.ts" | sort
```

Expect 29 command files: `compare`, `delete`, `diff`,
`doctor`, `drift`, `env`, `exec`, `export`, `get`, `hooks`,
`import`, `init`, `install`, `lint`, `merge-driver`,
`migrate-backend`, `namespace`, `pack`, `recipients`,
`report`, `revoke`, `rotate`, `scan`, `search`, `serve`,
`service`, `set`, `ui`, `update`. Plus the Cloud subcommand
group contributed by `@clef-sh/cloud` (`clef cloud login`,
`clef cloud init`, `clef cloud status`) which is registered
by `packages/cloud/src/commands/cloud.ts`, not by a file
under `packages/cli/src/commands/`.

Note: `agent` is NOT a CLI command — the agent is a
standalone package (`@clef-sh/agent`) published as a
separate binary. `bundle` was removed and replaced by
`pack` (see section 1.16 / 2.13). If either surfaces in
the command list, that is a High issue.

Check every command has:

- `--help` text with accurate description
- All flags documented with types and defaults
- Consistent error message format
- Correct exit codes
- Co-located `.test.ts` file with meaningful assertions

### 3.3 Pending values completeness

Check:

- `clef set --random` generates pending value and records
  it in `.clef-meta.yaml`
- `clef set` (normal) on pending key calls `markResolved`
- `clef init --random-values` scaffolds schema namespaces
- UI `+ Add key` row supports Random mode
- UI overflow menu has `Reset to random (pending)`
- UI pending rows show amber `PENDING` badge
- Matrix view shows `pendingCount` when > 0
- Lint reports pending keys as warnings
- `.clef-meta.yaml` is not in `.gitignore`
- `.gitignore` has explicit comment blocking future addition

### 3.4 Integration tests

Read `integration/tests/`.

Check:

- Server binding test attempts connection on non-loopback
  and asserts failure
- `exec-roundtrip` test runs with real SOPS binary
- `exec-signal` test sends real SIGTERM/SIGINT and
  verifies translated exit codes (130, 143)
- `export-roundtrip` test runs with real SOPS binary
- CI workflow installs sops and age before running
  `test:integration`
- Integration tests clean up temp files in `afterAll`
  with try/finally
- All integration tests call `checkSopsAvailable()` in
  `beforeAll()` to skip gracefully when SOPS is not
  installed

### 3.5 Design decision — no unencrypted namespaces

Check all four locations:

- `docs/guide/concepts.md` — clear statement in namespace
  section
- `docs/contributing/architecture.md` — Design Decisions
  section with full rationale
- `CONTRIBUTING.md` — reference to design decisions doc
- `packages/core/src/manifest/parser.ts` — comment at
  namespace validation logic

All four must be present. Missing any one is a Medium issue.

### 3.6 Merge driver completeness

Check:

- `clef merge-driver` command is registered in
  `packages/cli/src/index.ts`
- `clef hooks install` configures `.gitattributes` with
  the merge driver pattern for `.enc.yaml` / `.enc.json`
- `clef hooks install` configures `.git/config` with the
  merge driver command (`clef merge-driver %O %A %B`)
- `clef doctor` includes a merge driver check — verifies
  `.gitattributes` and `.git/config` are correctly set up
- `docs/guide/merge-conflicts.md` explains the problem,
  solution, setup, and security invariants
- `docs/cli/hooks.md` documents merge driver installation

### 3.7 Service identity and pack completeness

Check — CLI registration:

- `clef service` command is registered in
  `packages/cli/src/index.ts` with subcommands: `create`,
  `list`, `show`, `rotate`, `validate`, `add-env`
- `clef pack` command is registered in
  `packages/cli/src/index.ts`
- `clef revoke` command is registered in
  `packages/cli/src/index.ts`
- All three commands have co-located `.test.ts` files with
  meaningful assertions
- All three commands support `--dir` flag

Check — Core exports:

- `ServiceIdentityManager` is exported from
  `packages/core/src/index.ts`
- `ArtifactPacker` and related signing helpers are exported
  from `packages/core/src/index.ts`
- All related types are exported: `ServiceIdentityDefinition`,
  `ServiceIdentityEnvironmentConfig`,
  `ServiceIdentityDriftIssue`, `KmsEnvelope`,
  `ArtifactPackResult`
- KMS types are exported from core: `KmsProvider`,
  `KmsWrapResult`, `KmsProviderType`
- `KmsConfig`, `isKmsEnvelope` are exported from core types
- `KmsEnvelope` type is exported from core artifact types

Check — Manifest integration:

- `ManifestParser` accepts optional `service_identities` array
  in `clef.yaml`
- Parser validates: unique identity names, namespace references
  exist, all environments have entries
- Parser accepts `recipient` or `kms` per environment (mutually
  exclusive) — both present throws, neither present throws
- Valid `kms.provider` values: `aws`, `gcp`, `azure` — invalid
  provider throws `ManifestValidationError`
- `kms.keyId` is required and must be a non-empty string
- A manifest without `service_identities` continues to work
  unchanged — no breaking change to existing repos

Check — Lint integration:

- `clef lint` reports service identity drift issues when
  `service_identities` is present
- Drift issues have appropriate severity: `missing_environment`
  and `recipient_not_registered` are errors;
  `scope_mismatch` is a warning
- Each drift issue includes a `fixCommand` in the lint output
  where applicable

Check — Documentation:

- `docs/guide/service-identities.md` exists with:
  - Concept explanation (what, why, when to use)
  - Complete workflow (create → store → pack → deploy)
  - Key provider examples for AWS, GCP, Vault
  - Multi-namespace key prefixing explained
  - Rotation and recovery procedures
- `docs/cli/service.md` documents all subcommands and flags
- `docs/cli/pack.md` documents all flags and artifact format
- `docs/cli/revoke.md` documents the revocation workflow
- `docs/guide/ci-cd.md` includes pack/artifact generation in
  CI pipeline examples

Check — `.gitignore`:

- Generated artifacts (the `--output` target of `clef pack`
  and any user-configured artifact directory) are mentioned
  in documentation as files to add to `.gitignore`. Packed
  artifacts are encrypted, but committing them to the repo
  alongside `.clef/packed/` is a deliberate choice — the
  docs should explain both workflows

### 3.8 Bundled sops completeness

Check:

- `sops-version.json` exists at the repo root with
  `version` and `checksums` fields
- All five platform packages exist under `platforms/`:
  `sops-darwin-arm64`, `sops-darwin-x64`, `sops-linux-x64`,
  `sops-linux-arm64`, `sops-win32-x64`
- `packages/cli/package.json` lists all five as
  `optionalDependencies` with matching versions
- `resolveSopsPath()` and `resetSopsResolution()` are
  exported from `packages/core/src/index.ts`
- `SopsResolution` and `SopsSource` types are exported
  from `packages/core/src/index.ts`
- `clef doctor` displays `[bundled]`, `[system]`, or
  `[CLEF_SOPS_PATH]` next to the sops version
- `clef doctor --json` includes `source` and `path` in
  the `sops` object
- `docs/contributing/development-setup.md` documents:
  - The three-tier resolution order
  - How `npm ci` installs the bundled binary in CI
  - How to use `CLEF_SOPS_PATH` for explicit override
  - How to skip optional deps for unit-test-only workflows
- `docs/cli/overview.md` documents the sops resolution
  chain under Configuration
- `README.md` states sops is bundled and lists the
  `CLEF_SOPS_PATH` override
- `CLAUDE.md` lists the `platforms/` directory and the
  `SopsResolver` module
- `publish-sops.yml` workflow exists and is
  `workflow_dispatch` (manual trigger only)
- `scripts/download-sops.mjs` exists and handles all five
  platforms

### 3.9 Runtime package completeness

Check:

- `packages/runtime/` contains: VCS providers (github,
  gitlab, bitbucket), artifact sources (vcs, http, file),
  secrets-cache, disk-cache, decrypt, poller, KMS providers
  (aws, gcp stub, azure stub), and the `ClefRuntime` public
  API
- `packages/runtime/package.json` has `age-encryption` as
  its only production dependency and `@aws-sdk/client-kms`
  as an optional dependency — no express, no core, no sops
- `packages/runtime/.releaserc.json` exists with the same
  semantic-release config as other packages
- Runtime is listed in root `package.json` workspaces and
  builds before agent in the build script
- `typedoc.json` includes `packages/runtime/src/index.ts`
  as an entry point
- All runtime types are exported: `ClefRuntime`,
  `RuntimeConfig`, `VcsProvider`, `VcsProviderConfig`,
  `ArtifactSource`, `ArtifactFetchResult`, `SecretsCache`,
  `DiskCache`, `AgeDecryptor`, `ArtifactPoller`
- KMS exports: `KmsProvider`, `KmsWrapResult`,
  `KmsProviderType`, `AwsKmsProvider`, `createKmsProvider`
- `init()` convenience function is exported
- `createVcsProvider()` factory function is exported
- `createKmsProvider()` factory function is exported
- Signing exports from core: `buildSigningPayload`,
  `generateSigningKeyPair`, `signEd25519`, `signKms`,
  `verifySignature`, `detectAlgorithm`, `SignatureAlgorithm`
- Runtime config supports `verifyKey` — `RuntimeConfig`
  interface includes `verifyKey?: string` and it is passed
  through to `PollerOptions`

### 3.10 Agent package completeness

Check:

- The agent is a standalone package — NOT a CLI subcommand.
  Confirm `packages/cli/src/index.ts` does NOT import
  `registerAgentCommand` or reference `@clef-sh/agent`
- `packages/agent/` contains: server, config, health, main,
  and lifecycle modules (daemon, lambda-extension)
- Agent depends on `@clef-sh/runtime` (not `age-encryption`
  directly) — runtime provides cache, poller, decrypt, and
  VCS providers
- `packages/agent/src/index.ts` re-exports core types from
  `@clef-sh/runtime` for convenience
- Lambda Extension entry point exists under
  `packages/agent/src/lifecycle/`
- Agent SEA build workflow exists
  (`.github/workflows/build-sea.yml`) and triggers on
  `@clef-sh/agent@` release tags
- Agent SEA binaries follow the `clef-agent-{platform}`
  naming convention across all five platforms
- All agent configuration env vars are documented including
  VCS vars: `CLEF_AGENT_VCS_PROVIDER`, `CLEF_AGENT_VCS_REPO`,
  `CLEF_AGENT_VCS_TOKEN`, `CLEF_AGENT_VCS_IDENTITY`,
  `CLEF_AGENT_VCS_ENVIRONMENT`, `CLEF_AGENT_VCS_REF`,
  `CLEF_AGENT_VCS_API_URL`, `CLEF_AGENT_CACHE_PATH`,
  `CLEF_AGENT_SOURCE`, `CLEF_AGENT_PORT`,
  `CLEF_AGENT_CACHE_TTL`, `CLEF_AGENT_AGE_KEY`,
  `CLEF_AGENT_AGE_KEY_FILE`, `CLEF_AGENT_TOKEN`,
  `CLEF_AGENT_VERIFY_KEY`
- `docs/guide/agent.md` exists covering: concept, env var
  reference, deployment workflow, `@clef-sh/runtime` direct
  import examples
- `docs/cli/agent.md` documents the standalone binary and
  all env vars

### 3.11 Pack and drift completeness

Check:

- `clef pack` and `clef drift` are registered in
  `packages/cli/src/index.ts`
- Both commands support `--dir` flag
- Both commands have co-located `.test.ts` files with
  meaningful assertions
- `ArtifactPacker` and `DriftDetector` are exported from
  `packages/core/src/index.ts`
- Artifact envelope type (version, identity, environment,
  revision, ciphertextHash, ciphertext, keys, envelope,
  signature, signatureAlgorithm) is exported from
  `packages/core/src/index.ts`
- `docs/cli/pack.md` and `docs/cli/drift.md` exist
- Two artifact delivery backends are documented:
  - VCS (default): `pack` → commit to `.clef/packed/` →
    agent fetches via VCS API
  - Tokenless (S3/HTTP): `pack` → upload to S3/GCS → agent
    fetches via HTTPS
- Documentation presents both backends with a clear tradeoff
  table (operational complexity, token management, audit
  trail) — VCS is the default, tokenless is the alternative

### 3.12 CI workflow completeness for runtime

Check:

- `.github/workflows/release.yml` includes a
  `Release @clef-sh/runtime` step between core and agent
- `.github/workflows/publish-prerelease.yml` computes a
  prerelease version for runtime, stamps it, and publishes
  it for both alpha and beta channels
- `.github/workflows/publish-beta-npm.yml` stamps and
  publishes runtime to npm between core and agent
- `.github/workflows/ci.yml` build job includes
  `npm run build --workspace=packages/runtime` before agent
- `.github/workflows/ci.yml` coverage summary iterates over
  `packages/runtime`
- `.github/workflows/build-sea.yml` stamps runtime in the
  version loop and builds runtime before agent SEA build
- Root `package.json` build script includes runtime before
  agent: `npm run build -w packages/runtime`

### 3.13 SEA binary completeness

Check:

- CLI SEA workflow (`.github/workflows/build-sea-cli.yml`)
  triggers on `@clef-sh/cli@` release tags and builds all
  five platforms
- Agent SEA workflow (`.github/workflows/build-sea.yml`)
  triggers on `@clef-sh/agent@` release tags and builds all
  five platforms
- Both workflows generate SHA256 checksums and upload them
  to the GitHub Release alongside the binaries
- `packages/cli/sea-config.json` exists and references the
  correct entry point and any embedded UI assets
- `packages/agent/` has an equivalent `sea-config.json`
- `www/public/install.sh` downloads the clef CLI SEA binary
  (not an npm tarball) and verifies its checksum

### 3.14 Install script completeness

Check:

- `www/public/install.sh` is served at
  `https://clef.sh/install.sh` and `www/dist/client/install.sh`
  is kept in sync with the source
- All four Unix platforms are handled: `linux-x64`,
  `linux-arm64`, `darwin-x64`, `darwin-arm64`
- Windows produces a helpful error suggesting
  `npm install -g @clef-sh/cli` with the download link
- All documented env vars are implemented: `CLEF_VERSION`,
  `CLEF_INSTALL_DIR`, `SOPS_VERSION`, `SOPS_SKIP`
- Version auto-detection queries the GitHub Releases API
  and finds the latest `@clef-sh/cli@` tag — not the
  `/latest` endpoint (which may return a non-CLI release)
- Sops is downloaded and verified alongside clef;
  `SOPS_SKIP=1` skips it for users who manage sops separately
- PATH check warns the user if the install directory is not
  on their `$PATH`

### 3.15 Structure commands — `namespace` and `env`

Read:

- `packages/cli/src/commands/namespace.ts`
- `packages/cli/src/commands/env.ts`
- `packages/core/src/structure/` (add/remove namespace/env)
- `packages/core/src/tx/` (transaction manager used by
  structure mutations — see CLAUDE.md memory note about
  `TransactionManager`)

Check:

- `clef namespace add <name>` and `clef namespace remove
<name>` both mutate the manifest atomically via
  `TransactionManager` — a failure partway through must
  roll back the manifest to its pre-mutation state
- `clef env add <name>` / `clef env remove <name>` /
  `clef env edit <name>` behave the same way
- Removing a namespace also deletes the matching
  `{namespace}/{environment}.enc.yaml` files on success —
  but only after the manifest write succeeds
- Removing an environment also deletes files across every
  namespace for that environment
- Rollback test: a mock filesystem error mid-operation
  leaves the repo in the original state (manifest and
  files both unchanged)
- The transaction wrapper is exercised by unit tests —
  not just relied upon via integration

### 3.16 Cloud and SaaS surface completeness

Check:

- `packages/cloud/` is listed in root `package.json`
  workspaces
- `@clef-sh/cloud` is declared as an optional dependency
  of `@clef-sh/cli` — NOT a direct dependency. The OSS
  CLI must still build and run if cloud is absent
- `clef cloud` subcommand group is registered via
  `packages/cloud/src/cli.ts` and only loaded lazily when
  the user invokes a `clef cloud *` command
- `packages/cloud/src/index.ts` exports a `registerCli`
  function, not a module that executes HTTP clients on
  import
- `@clef-sh/keyservice-{platform}-{arch}` optional
  dependencies exist for all five platforms and their
  versions are pinned in `packages/cloud/package.json`
- `docs/cloud/` exists with at least `overview.md`,
  `login.md`, and `init.md` pages
- The README describes Clef Cloud as opt-in and links to
  the cloud docs — but does not mislead readers into
  thinking it is required

### 3.17 Client SDK completeness

Check:

- `packages/client/` builds as a zero-dependency module
  (production dependencies empty; peer-deps allowed)
- Main entry exports: `ClefClient`, `createClient`,
  `ClefClientConfig`
- `/kms` subpath exports a KMS provider interface
  compatible with `@clef-sh/runtime`'s `KmsProvider` type
- The SDK is published separately to npm and its version
  moves independently from the CLI
- `docs/runtime/client.md` exists covering install,
  usage, env-var fallback, and telemetry

### 3.18 Analytics opt-out

Check:

- `@clef-sh/analytics` is an optional dependency of the
  CLI, not a direct one
- Telemetry is opt-out via `CLEF_TELEMETRY=0` (or similar)
  and via a config flag in `~/.clef/config.yaml`
- No telemetry event contains decrypted values, secret
  names, manifest content, or file paths that could leak
  project structure. Only command names and exit codes
  are permitted in events
- First-run prompt exists notifying the user that
  anonymous telemetry is enabled and explaining how to
  opt out

---

## 4. Test Quality Audit

### 4.1 Coverage genuineness

Read a sample of test files — pick three from core, two
from CLI, two from UI. For each:

- Are assertions testing behaviour or just that code ran?
- Are error branches tested, not just happy paths?
- Are mock assertions verifying the right calls were made
  with the right arguments?

Flag any test that passes without actually asserting the
behaviour it claims to test.

Check that Button usages in tests use data-testid not getByText for behavioural assertions.

### 4.2 Security-critical test coverage

Check specifically:

- A test asserting `clef set` does NOT print the value
  in its output — not just that it prints something
- A test asserting `clef exec` does NOT include env var
  values in error output when child fails to start
- A test asserting `generateRandomValue` uses
  `crypto.randomBytes` — not just that it returns a string
- A test asserting the Linux `clef export` warning goes
  to stderr not stdout
- A test asserting `--format dotenv` is rejected with an
  explanation, not just an error
- `packages/ui/src/server/api.test.ts` — a test asserting
  the PUT handler does NOT echo the value in the response
  (`res.body.value` is `undefined`)
- `packages/ui/src/server/api.test.ts` — a test asserting
  `Cache-Control: no-store` is set on all endpoints that
  return decrypted data

### 4.3 Pending state atomicity

Read:

- `packages/cli/src/commands/set.ts` — the --random path
- `packages/core/src/pending/metadata.ts`
- `packages/ui/src/server/api.ts` — the PUT handler
- `packages/ui/src/server/api.test.ts`

Check:

- Is there a test for the case where encrypt succeeds but
  `markPending` fails? What happens?
- Is there a test for the case where encrypt fails? Does
  `markPending` get called anyway?
- The API handler rolls back the encryption when
  `markPendingWithRetry` fails — verify this is tested
- The partial failure case (pending fails AND rollback
  fails) is tested and returns a clear error

### 4.4 Sops resolver and bundling test coverage

Read:

- `packages/core/src/sops/resolver.test.ts`
- `packages/core/src/dependencies/checker.test.ts`

Check:

- A test asserts `CLEF_SOPS_PATH` takes precedence over
  all other resolution methods
- A test asserts the fallback to system PATH `"sops"` when
  no env var and no bundled package
- A test asserts the result is cached across calls (same
  object reference returned)
- A test asserts `resetSopsResolution()` clears the cache
  and subsequent calls re-resolve
- `checker.test.ts` includes tests verifying the `source`
  and `resolvedPath` fields are populated for sops checks
- `checker.test.ts` includes a test verifying `source` is
  `undefined` for git checks (git does not use the resolver)
- `checker.test.ts` includes a test for `CLEF_SOPS_PATH`
  integration — setting the env var changes the command
  passed to `runner.run()`

### 4.5 Service identity test coverage

Read:

- `packages/core/src/service-identity/manager.test.ts`
  (if it exists)
- `packages/cli/src/commands/service.test.ts`
- `packages/core/src/artifact/packer.test.ts`
- `packages/cli/src/commands/pack.test.ts`

(Pack/artifact test coverage is covered in detail by
section 4.9. This section focuses on the service identity
side of the relationship.)

Check — Service identity tests:

- A test asserts private keys are printed to stdout during
  `create` — and that no subsequent call can retrieve them
- A test asserts `show` and `list` only display public keys
- A test asserts creating a duplicate identity name fails
- A test asserts creating with a nonexistent namespace fails
- A test asserts rotation generates new keys different from
  the old ones
- A test asserts rotation removes old recipients and adds
  new ones on scoped SOPS files
- A test asserts single-environment rotation leaves other
  environments unchanged
- Drift detection tests cover all issue types:
  `missing_environment`, `namespace_not_found`,
  `recipient_not_registered`, `scope_mismatch`
- A test asserts scope enforcement — recipient is NOT
  registered on files outside the identity's namespace scope

Check — KMS envelope tests:

- A test asserts `create` with `kmsEnvConfigs` does NOT
  call `generateAgeIdentity()` and returns empty
  `privateKeys`
- A test asserts `create` with mixed age/KMS environments
  generates age keys only for non-KMS environments
- A test asserts KMS config is stored correctly in the
  identity's `environments` map
- A test asserts `registerRecipients()` skips KMS-backed
  environments — `addRecipient` is not called for them
- A test asserts KMS-backed environments are skipped during
  `rotateKey()`

Check — Security-critical:

- A test asserts that if decryption fails during identity
  setup (reading existing recipients), no partial state
  is written to `clef.yaml`
- A test asserts `clef service add-env` atomically adds a
  new environment to an existing identity without touching
  the other environments' keys
- A test asserts `clef revoke <identity>` rotates all
  scoped files and removes the revoked recipient before
  any file is re-encrypted with the new recipient — the
  old recipient must not appear in any post-revoke file

### 4.6 Merge driver test coverage

Read:

- `packages/core/src/merge/driver.test.ts`
- `packages/cli/src/commands/merge-driver.test.ts`

Check:

- All 13+ merge scenarios are tested in `driver.test.ts`
  (unchanged, one-sided, two-sided same, two-sided
  different, additions, deletions, etc.)
- CLI tests verify clean merge flow (decrypt → merge →
  re-encrypt → exit 0)
- CLI tests verify conflict flow (report conflicting keys
  → exit 1)
- CLI tests verify error handling (missing manifest,
  decryption failure)
- Assertions verify merge output values, not just that
  the function ran

### 4.7 Runtime test coverage

Read all `*.test.ts` files under `packages/runtime/src/`.

Check — VCS providers:

- GitHub: happy path, 404, 401, 403 are tested
- GitLab: happy path, 404, 401, 403 are tested
- Bitbucket: happy path (two-call flow), error cases tested
- Custom `apiUrl` is tested for all three providers
- `ref` query parameter is tested for all three providers

Check — Artifact sources:

- `VcsArtifactSource` constructs correct path
  (`.clef/packed/{identity}/{environment}.age.json`)
- `HttpArtifactSource` returns ETag as `contentHash`
- `FileArtifactSource` reads from disk
- VCS/HTTP error propagation is tested

Check — Poller:

- Content-hash short-circuit: second fetch with same SHA
  skips parse+decrypt — `cache.swap` not called
- Revision-based skip: same revision skips decrypt even
  without content hash
- Disk cache write: successful fetch writes to disk cache
- Disk cache fallback: fetch failure reads from disk cache
- Disk cache empty: fetch failure + empty cache throws
- Integrity check: tampered `ciphertextHash` is rejected
- `onRefresh` callback is tested
- Polling interval and `onError` callback are tested
- KMS envelope artifact: real AES-256-GCM ciphertext with
  a known DEK — mock KMS unwrap returns the DEK, poller
  decrypts and populates cache with correct values. Verify
  `createKmsProvider` is called with the provider from the
  artifact's `envelope`
- KMS AES-GCM auth failure: corrupted `authTag` in the
  envelope causes decryption to throw — confirm the error
  propagates and cache remains empty
- KMS path isolation: a test asserts `AgeDecryptor` is NOT
  called when `envelope` is present — the two paths must
  be completely separate
- Age-only artifact without private key: throws clear error
- Incomplete envelope fields: throws validation error —
  must also cover envelope with provider/keyId/wrappedKey/
  algorithm but MISSING iv and authTag
- Signature verification: valid signature accepted, unsigned
  artifact rejected when verify key configured, wrong key
  rejected, unsigned accepted when no verify key (see
  section 4.10 for full signing test coverage)

Check — KMS providers:

- `aws.test.ts`: wrap returns wrapped key + algorithm,
  unwrap returns plaintext, KMS errors propagate
- `index.test.ts`: factory creates AWS provider, GCP/Azure
  throw "not yet implemented", unknown provider throws
- `gcp.test.ts` and `azure.test.ts`: both methods throw
  "not yet implemented"

Check — ClefRuntime:

- VCS source, HTTP source, and file source all tested
- Missing config (no source, no VCS) throws
- Missing age key does NOT throw (optional for KMS envelope)
- `ready`, `get`, `getAll`, `env`, `keys`, `revision`
  all tested after `start()`
- `init()` returns a ready runtime

### 4.8 Agent test coverage

Read all `*.test.ts` files under `packages/agent/src/`.

Check:

- A test asserts the server binds to `127.0.0.1` and rejects
  a connection on any non-loopback address
- Auth tests: missing token → 401, wrong token → 401,
  correct token → 200 for all protected routes
- Host header validation test: a non-loopback Host value
  returns 403
- `/v1/health` and `/v1/ready` return 200 without any token
- Config tests cover VCS config resolution: valid full VCS
  config, partial VCS config throws, invalid provider throws,
  either source or VCS required
- Config tests assert age key is optional — missing both
  `CLEF_AGENT_AGE_KEY` and `CLEF_AGENT_AGE_KEY_FILE` does
  NOT throw `ConfigError`
- Config tests cover `cachePath` env var
- Agent server imports `SecretsCache` from `@clef-sh/runtime`
  — not from a local module

### 4.9 Pack and drift test coverage

Read:

- `packages/cli/src/commands/pack.test.ts`
- `packages/cli/src/commands/drift.test.ts`
- Core-level test files for `ArtifactPacker` and
  `DriftDetector` if they exist

Check:

- Pack: a test asserts the output file contains age ciphertext
  — not plaintext values
- Pack: a test asserts a nonexistent identity produces a
  clear error and does not create an output file
- Pack: a test asserts `--output` is required
- Pack (KMS): a test asserts KMS identity produces an
  artifact with `envelope` field containing provider, keyId,
  wrappedKey, algorithm, iv, and authTag — with iv decoding
  to 12 bytes and authTag decoding to 16 bytes
- Pack (KMS): a test asserts `kms.wrap()` is called with
  the correct key ID and a 32-byte buffer (the DEK)
- Pack (KMS): a test asserts the AES-256-GCM ciphertext
  round-trips — decrypt the artifact's ciphertext using the
  captured DEK, iv, and authTag to recover original values
- Pack (KMS): a test asserts `age-encryption` Encrypter is
  NOT called for KMS identities — only Node crypto is used
- Pack (KMS): a test asserts missing KMS provider throws
  a clear error
- Pack (age regression): a test asserts age-only identity
  still produces an artifact without `envelope` even when
  a KMS provider is injected
- Drift: a test asserts exit 0 when matrices are identical,
  exit 1 when they differ
- Drift: a test asserts `--namespace` correctly limits the
  comparison scope
- Drift: a test asserts that no SOPS subprocess is invoked —
  the command must not call `SubprocessRunner.run()` with
  sops as the executable

### 4.10 Artifact signing test coverage

Read:

- `packages/core/src/artifact/signer.test.ts`
- `packages/core/src/artifact/packer.test.ts` — the
  "artifact signing" describe block
- `packages/runtime/src/signature.test.ts`
- `packages/runtime/src/poller.test.ts` — the
  "signature verification" describe block

Check — Signer module:

- `buildSigningPayload` determinism: same artifact input
  produces the same output on repeated calls
- `buildSigningPayload` key sorting: different key orderings
  produce the same payload
- `buildSigningPayload` includes all fields — a test
  asserts the payload string contains version, identity,
  environment, revision, packedAt, ciphertextHash, sorted
  keys, expiresAt, and all six envelope fields (provider,
  keyId, wrappedKey, algorithm, iv, authTag)
- `buildSigningPayload` empty optional fields: a test
  asserts empty strings appear for missing expiresAt and
  all six envelope fields (including iv and authTag)
- Ed25519 round-trip: sign with private key, verify with
  matching public key — passes
- Ed25519 wrong key: sign with one key, verify with a
  different key — fails
- Ed25519 tampered payload: sign, modify payload, verify —
  fails
- Ed25519 tampered signature: sign, flip bits in signature,
  verify — fails
- KMS signing: `signKms` calls `kms.sign` with SHA-256
  digest (not raw payload)
- KMS missing sign method: `signKms` throws if `kms.sign`
  is undefined
- `detectAlgorithm`: Ed25519 key → `"Ed25519"`, EC P-256
  key → `"ECDSA_SHA256"`
- ECDSA round-trip: sign with EC P-256 private key, verify
  via `verifySignature` — passes

Check — Packer signing:

- Ed25519 signing: when `signingKey` is provided, artifact
  JSON contains `signature` and `signatureAlgorithm`
  `"Ed25519"`, and the signature verifies with the matching
  public key
- No signing: when neither signing option is provided,
  artifact has no `signature` or `signatureAlgorithm`
- TTL + signing: when both `ttl` and `signingKey` are
  provided, the signature covers the `expiresAt` field
  (the payload contains the expiresAt string, and the
  signature verifies)
- Mutual exclusion: both `signingKey` and `signingKmsKeyId`
  throws before any decryption
- KMS signing: when `signingKmsKeyId` is provided, artifact
  has `signature` and `signatureAlgorithm` `"ECDSA_SHA256"`,
  and `kms.sign` is called with the correct key ARN
- KMS without provider: `signingKmsKeyId` without a KMS
  provider throws clearly

Check — Runtime signature verification:

- Valid signature accepted: signed artifact + correct verify
  key → cache populated
- Unsigned artifact rejected: verify key configured but
  artifact has no signature → throws
- Wrong key rejected: artifact signed with key A, verify
  key is key B → throws
- No verify key: unsigned artifact accepted normally when
  `verifyKey` is not configured (backward compatible)
- Tampered ciphertextHash: fails integrity check before
  reaching signature verification
- ECDSA verification: artifact signed with EC P-256 key +
  correct verify key → accepted
- Telemetry: signature_missing and signature_invalid
  reasons emitted on respective failure paths

Check — Cross-package payload consistency:

- A test must exist (in either package) that constructs
  the same artifact and verifies both `buildSigningPayload`
  implementations produce identical output. If no such
  test exists, the two implementations can silently drift,
  which would either break verification (false rejects)
  or weaken it (false accepts if a field is omitted from
  one side). This is a Medium issue if missing

---

## 5. Documentation Accuracy Audit

### 5.1 CLI reference accuracy

Pick three CLI pages at random from `docs/cli/`. For each:

- Read the docs page
- Read the corresponding command implementation
- Verify every flag documented actually exists in the code
- Verify every flag in the code is documented
- Verify every example command works as written

Flag any inaccuracy as a Low issue (High if the example
would cause data loss or a security problem).

### 5.2 CI/CD guide accuracy

Read `docs/guide/ci-cd.md` in full.

Check:

- The GitHub Actions examples use correct action syntax
- The two-checkout Pattern B example is accurate
- The `CLEF_AGE_KEY` environment variable name is correct
  per the Clef documentation (Clef translates to `SOPS_AGE_KEY` for the subprocess)
- The IAM policy example grants minimum necessary permissions
- Every `clef` command in the examples exists and has the
  flags shown

### 5.3 Quick start accuracy

Read `docs/guide/quick-start.md`.

Follow every command exactly as written. Would a new user
following this guide get a working setup? Flag any command
that would fail or require steps not shown.

### 5.4 Pending values guide accuracy

Read `docs/guide/pending-values.md`.

Check:

- The four-step `--random-values` workflow is present and
  accurate
- The `.clef-meta.yaml` format shown matches the actual
  implementation
- The FAQ answers are correct

### 5.5 Merge conflicts guide accuracy

Read `docs/guide/merge-conflicts.md`.

Check:

- The problem description (SOPS re-encryption with fresh
  nonce invalidates all lines) is technically accurate
- The merge driver solution (decrypt → three-way merge →
  re-encrypt) matches the implementation
- The `.gitattributes` example pattern matches what
  `clef hooks install` actually writes
- The `.git/config` merge driver command syntax
  (`clef merge-driver %O %A %B`) matches the CLI
  registration
- The conflict output example matches what the CLI
  actually prints
- The security invariants section (no plaintext to disk,
  no custom crypto, MAC integrity) is accurate

### 5.6 Scanning guide accuracy

Read `docs/guide/scanning.md`.

Check:

- The pattern list matches patterns defined in
  `packages/core/src/scanner/patterns.ts`
- The entropy threshold (Shannon > 4.5, min 20 chars)
  matches the implementation
- `.clefignore` syntax matches
  `packages/core/src/scanner/ignore.ts`
- Exit codes match `packages/cli/src/commands/scan.ts`
- Pre-commit hook behaviour description is accurate

### 5.7 Service identities guide accuracy

Read `docs/guide/service-identities.md`.

Check:

- The concept explanation distinguishes service identities
  (machine keypairs or KMS envelope) from human recipients
- Two encryption modes (age-only, KMS envelope) are
  documented with a comparison table
- Two artifact delivery backends (VCS, tokenless/S3) are
  documented with a tradeoff table covering: operational
  complexity, token management, audit trail, when to use
- The manifest YAML examples show age-only, KMS-only, and
  mixed configurations — confirm they match what
  `clef service create` actually writes to `clef.yaml`
- `--kms-env` flag format (`env=provider:keyId`) is
  documented with examples
- KMS envelope: no private keys printed, no rotation needed
  — this is clearly stated
- Multi-namespace key prefixing (`namespace/KEY`) is explained
  and matches the implementation
- Rotation instructions are accurate — age-only envs get new
  keys, KMS envs are skipped
- CI workflow examples exist for both VCS delivery (git push)
  and tokenless delivery (S3 upload)
- The security model covers both age-only and KMS envelope
  artifacts — what each contains, trust boundaries

### 5.8 Service and pack CLI reference accuracy

Read `docs/cli/service.md` and `docs/cli/pack.md`.

For each:

- Read the docs page
- Read the corresponding command implementation
- Verify every flag documented actually exists in the code
  — including `--kms-env` on `service create`
- Verify every flag in the code is documented
- Verify example commands match the actual CLI registration
- Verify `--kms-env` format documented (`env=provider:keyId`)
  matches the parsing logic in `service.ts`
- Verify that `docs/cli/bundle.md` does NOT exist — the
  bundle command was replaced by pack. A stale bundle page
  is a Low issue (redirect or delete)

Flag any inaccuracy as Low (High if the example would cause
key material exposure or data loss).

### 5.9 Migration guide accuracy

Read `docs/guide/migrating.md`.

Check:

- `clef import` command syntax matches the implementation
  in `packages/cli/src/commands/import.ts`
- `--stdin`, `--format`, `--prefix`, `--overwrite`,
  `--keys` flags all exist in the code
- Third-party examples (1Password, AWS, Vault, Doppler)
  use correct CLI syntax for those tools
- The verification checklist commands all exist and work
  as described

### 5.10 Agent and runtime guide accuracy

Read `docs/guide/agent.md` and `docs/cli/agent.md`.
Read `packages/agent/src/config.ts`,
`packages/agent/src/server.ts`, and
`packages/runtime/src/index.ts`.

Check:

- Every env var documented in the guide matches the actual
  config implementation — names, defaults, and required vs
  optional all match. This includes VCS env vars:
  `CLEF_AGENT_VCS_PROVIDER`, `CLEF_AGENT_VCS_REPO`,
  `CLEF_AGENT_VCS_TOKEN`, `CLEF_AGENT_VCS_IDENTITY`,
  `CLEF_AGENT_VCS_ENVIRONMENT`, `CLEF_AGENT_VCS_REF`,
  `CLEF_AGENT_VCS_API_URL`, `CLEF_AGENT_CACHE_PATH`
- API routes documented (`/v1/secrets`, `/v1/secrets/:key`,
  `/v1/keys`, `/v1/health`, `/v1/ready`) match the routes
  registered in `server.ts`
- Token authentication description matches the
  implementation: Bearer scheme, 64-hex-char token
- The agent is documented as a standalone binary — not a
  CLI subcommand. No documentation should reference
  `clef agent start`
- `@clef-sh/runtime` direct import examples (Lambda, long-
  running service) are documented in `docs/guide/agent.md`
  — both VCS and tokenless (S3 + KMS envelope) examples
- `RuntimeConfig` fields documented match the actual
  interface in `packages/runtime/src/index.ts`
- `CLEF_AGENT_AGE_KEY` and `CLEF_AGENT_AGE_KEY_FILE` are
  documented as optional (for KMS envelope artifacts)
- Two delivery backends documented: VCS (default, pack →
  commit → VCS API fetch) and tokenless (pack → S3 upload
  → HTTP fetch). VCS is the recommended default
- Poll interval, port, and other config knobs shown in
  the guide match their defaults in `config.ts`

### 5.11 Pack, drift, and installation guide accuracy

Read `docs/cli/pack.md`, `docs/cli/drift.md`, and
`docs/guide/installation.md`.
Read `packages/cli/src/commands/pack.ts` and
`packages/cli/src/commands/drift.ts`.

Check:

- Every flag shown in pack docs exists in `pack.ts`;
  every flag in `pack.ts` is documented — including
  `--signing-key`, `--signing-kms-key`, and
  corresponding env vars `CLEF_SIGNING_KEY`,
  `CLEF_SIGNING_KMS_KEY`
- Every flag shown in drift docs exists in `drift.ts`;
  every flag in `drift.ts` is documented
- Installation guide documents both install methods:
  one-line shell installer and `npm install -g @clef-sh/cli`
- Installation guide lists all supported env vars:
  `CLEF_VERSION`, `CLEF_INSTALL_DIR`, `SOPS_VERSION`,
  `SOPS_SKIP`
- Installation guide notes that sops is co-installed by
  the shell installer and explains `SOPS_SKIP` for users
  who manage sops separately
- Shell installer example (`curl … | sh`) matches what
  `install.sh` actually does — no flags or steps that
  don't exist

---

## Output Format

For each section produce findings only — no passing
commentary.

Format each finding as:

```
[SEVERITY] file/path.ts (line N if known)
Problem: what is wrong
Fix: exact change needed
```

At the end produce the consolidated fix list sorted by
severity. This is the only output a developer needs to
act on. Everything else is noise.
