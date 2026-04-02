# Cloud Key Resolution

Product Requirements Document

Version 0.1 | April 2026

Classification: Internal — Engineering & Product

**DRAFT**

*This document defines a cloud-provider-agnostic key identifier scheme for Clef Cloud's managed KMS backend. It covers the key ID format, resolution flow, DynamoDB schema, SOPS compatibility, and the changes required in the Cloud API and keyservice. Familiarity with the Clef Cloud product model is assumed.*

# 1. Problem

Clef Cloud manages KMS keys on behalf of users. The current design passes raw AWS ARNs (`arn:aws:kms:us-east-1:123456789:key/...`) through every layer of the stack: the `clef.yaml` manifest, SOPS CLI arguments, encrypted file metadata, the gRPC key service proto, and the Cloud HTTP API. This creates three problems:

1. **Provider coupling.** The CLI, keyservice, and encrypted files are structurally bound to AWS. Adding GCP KMS or Azure Key Vault support would require client-side changes at every layer.

2. **Infrastructure leakage.** AWS ARNs expose Clef's account ID, region, and internal key identifiers to users. These are implementation details the user should never see or manage.

3. **Operational rigidity.** Rotating the underlying KMS key, changing regions, or migrating providers requires re-encrypting every SOPS file the user has. With an abstract identifier, these become backend-only operations.

The solution is a Clef-branded key identifier that the Cloud backend resolves to the real provider key at request time.

# 2. Key ID Format

```
clef:<integrationId>/<keyAlias>
```

Examples:
- `clef:int_abc123/production`
- `clef:int_abc123/staging-us-east`

Validation pattern: `^clef:[a-z0-9_]+/[a-z0-9_-]+$`

## 2.1 Format Rationale

| Property | Rationale |
|----------|-----------|
| `clef:` prefix | Unambiguously not an AWS ARN, GCP resource ID, or Azure URL. Any code that encounters this string knows it is a Clef-managed key. |
| `integrationId` | Scopes the key to a specific Cloud integration. Prevents cross-tenant key references. The integration ID is assigned by the Cloud API during `clef cloud init`. |
| `keyAlias` | Human-friendly, user-chosen name (typically the environment name). Avoids exposing internal database IDs or provider-specific identifiers. |
| Slash separator | Clean visual distinction between scope and key name. Reads naturally in SOPS file metadata. |

## 2.2 SOPS Compatibility

SOPS does not validate the `arn` field format. The relevant code path in the vendored SOPS source:

1. `NewMasterKeyFromArn` (kms/keysource.go) calls `strings.Replace(arn, " ", "", -1)` and then checks for `+arn:` to split role annotations. A `clef:` string has no spaces and does not contain `+arn:`, so it is stored verbatim in `key.Arn`.

2. `KeyFromMasterKey` (keyservice/keyservice.go) maps `mk.Arn` to `KmsKey.Arn` in the gRPC message without validation.

3. When using a remote key service (`--keyservice` flag), SOPS sends the gRPC request to the remote service. If the remote service succeeds, SOPS never calls the local AWS SDK with the string.

The Clef key ID passes through the `KmsKey.arn` proto field unmodified. This is a semantic mismatch — the field is called `arn` but holds a non-ARN — but it is purely internal to the wire protocol. The keyservice controls what happens with the string.

# 3. End-to-End Flow

```
clef.yaml                    cloud.keyId: "clef:int_abc123/production"
    |
CLI (SopsClient)             sops encrypt --kms "clef:int_abc123/production"
                               --enable-local-keyservice=false
                               --keyservice tcp://127.0.0.1:<port>
    |
SOPS                         KmsKey{Arn: "clef:int_abc123/production"}
                               -> gRPC Encrypt(key, plaintext_dek)
    |
keyservice (proxy.go)        forwards key ID as-is to Cloud API
                               POST /api/v1/cloud/kms/encrypt
                               {"keyArn": "clef:int_abc123/production", "plaintext": "<b64>"}
    |
Cloud API                    detects clef: prefix
                               -> parse integrationId + keyAlias
                               -> validate bearer token has access
                               -> DynamoDB lookup -> resolve to real ARN
    |
AWS KMS SDK                  Encrypt(KeyId="arn:aws:kms:us-east-1:...", Plaintext=DEK)
    |
Response                     wrapped DEK flows back:
                               Cloud API -> keyservice -> SOPS -> encrypted file
```

## 3.1 `--enable-local-keyservice=false`

This SOPS flag is required when using Cloud. Without it, SOPS tries the local key service first. The local SOPS KMS provider would attempt to call the AWS SDK with `clef:int_abc123/production` as a KeyId. The AWS SDK would reject it with an error, SOPS would log the failure, and then fall back to the remote keyservice. The flag eliminates this noise — all KMS operations go exclusively through the Clef keyservice.

## 3.2 Encrypted File Metadata

After encryption, SOPS writes the key ID into the file header:

```yaml
sops:
  kms:
    - arn: clef:int_abc123/production
      created_at: "2026-04-02T12:00:00Z"
      enc: AQICAHh...  # base64-encoded wrapped DEK
  lastmodified: "2026-04-02T12:00:00Z"
  mac: ENC[AES256_GCM,data:...]
  version: 3.9.4
```

The `clef:` prefix in the `arn` field is immediately recognizable to anyone inspecting the file. It communicates that this file uses Clef Cloud, not raw AWS KMS with local credentials.

On decrypt, SOPS reads `sops.kms[0].arn` from the file, constructs a `KmsKey{Arn: "clef:int_abc123/production"}`, and sends it to the remote keyservice. The keyservice forwards it to the Cloud API. The Cloud API resolves it and calls KMS Decrypt. The unwrapped DEK flows back to SOPS, which decrypts the file.

# 4. Cloud API: Key Resolution

## 4.1 DynamoDB Schema

Key mappings are stored alongside existing Cloud project records in the same DynamoDB table.

| Field | Type | Description |
|-------|------|-------------|
| `pk` | String | `INTEGRATION#<integrationId>` |
| `sk` | String | `KEY#<keyAlias>` |
| `awsKmsArn` | String | `arn:aws:kms:us-east-1:123:key/...` |
| `provider` | String | `aws` (future: `gcp`, `azure`) |
| `region` | String | `us-east-1` |
| `status` | String | `active` / `disabled` / `pending-rotation` |
| `createdAt` | String | ISO 8601 timestamp |
| `rotatedAt` | String | ISO 8601 timestamp (last key rotation) |
| `metadata` | Map | Provider-specific metadata (e.g., key spec, usage) |

### Access Patterns

| Pattern | Key condition |
|---------|--------------|
| Get key by alias | `pk = INTEGRATION#<id>`, `sk = KEY#<alias>` |
| List all keys for integration | `pk = INTEGRATION#<id>`, `sk begins_with KEY#` |

## 4.2 Resolution Flow

```
1. Receive encrypt/decrypt request: { keyArn: "clef:int_abc123/production", ... }
2. Detect clef: prefix
3. Parse: integrationId = "int_abc123", keyAlias = "production"
4. Validate: bearer token grants access to integration "int_abc123"
5. DynamoDB GetItem(pk="INTEGRATION#int_abc123", sk="KEY#production")
6. Verify: status == "active"
7. Extract: awsKmsArn, region
8. Create regional KMS client for resolved region
9. Call: KMS Encrypt/Decrypt(KeyId=awsKmsArn, ...)
10. Return: { ciphertext/plaintext: "<base64>" }
```

If the key is not found, disabled, or the token lacks access: return HTTP 403 with a descriptive error. The keyservice surfaces this as a gRPC `Internal` error, which SOPS reports to the user.

## 4.3 Backward Compatibility

The Cloud API detects the key ID format on the wire:

- Starts with `clef:` — resolve via DynamoDB mapping (new path)
- Starts with `arn:aws:kms:` — use directly (legacy path, deprecated)

This allows existing deployments to continue working during migration. The legacy path will be removed in a future API version.

## 4.4 Key Management Endpoints

New endpoints for managing key mappings, used by `clef cloud init` and future `clef cloud keys` commands:

```
POST   /api/v1/cloud/keys          Create a key mapping (provisions KMS key)
GET    /api/v1/cloud/keys          List key mappings for an integration
GET    /api/v1/cloud/keys/:alias   Get a specific key mapping
DELETE /api/v1/cloud/keys/:alias   Disable a key mapping (soft delete)
```

### POST /api/v1/cloud/keys

Request:
```json
{
  "alias": "production",
  "region": "us-east-1"
}
```

Response:
```json
{
  "keyId": "clef:int_abc123/production",
  "alias": "production",
  "provider": "aws",
  "region": "us-east-1",
  "status": "active",
  "createdAt": "2026-04-02T12:00:00Z"
}
```

The Cloud API provisions the actual KMS key in Clef's AWS account, creates the DynamoDB mapping, and returns the Clef key ID. The user never sees or handles the AWS ARN.

# 5. Keyservice Changes

The keyservice binary (`clef-sh/keyservice`) requires minimal changes. The proxy already forwards whatever string is in `KmsKey.Arn` to the Cloud API without interpretation.

## 5.1 Required Changes

| File | Change | Reason |
|------|--------|--------|
| `internal/proxy/proxy.go` | Error message: `"only AWS KMS keys are supported"` -> `"only KMS keys are supported"` | Provider-agnostic language |
| `internal/proxy/proxy.go` | Log key: `slog.String("arn", ...)` -> `slog.String("keyId", ...)` | Accurate when the value is a Clef key ID |
| `internal/cloud/client.go` | Go struct field: `KeyARN` -> `KeyID` (keep `json:"keyArn"` for wire compat) | Internal clarity; no wire format change |
| `internal/proxy/proxy_test.go` | Add test cases with `clef:` prefix key IDs | Verify the proxy handles non-ARN strings correctly |
| `internal/cloud/client_test.go` | Add test cases with `clef:` prefix key IDs | Verify the HTTP client sends non-ARN strings correctly |

## 5.2 No Wire Format Change (v1)

The JSON field name remains `keyArn` in the HTTP API for backward compatibility:

```json
{
  "keyArn": "clef:int_abc123/production",
  "plaintext": "<base64>"
}
```

A future v2 API may rename this to `keyId`. The Go struct rename (`KeyARN` -> `KeyID`) is internal only and does not affect the wire format.

# 6. Security Properties

## 6.1 No ARN Exposure

Users never see or handle AWS ARNs. The Cloud backend owns the mapping. This eliminates a class of misconfiguration where users reference wrong ARNs, ARNs from other accounts, or ARNs that have been rotated.

## 6.2 Scope Isolation

The `integrationId` in the key ID is validated against the bearer token on every encrypt/decrypt request. The Cloud API will not resolve a key ID for an integration the token does not have access to. Cross-tenant key access is impossible without a valid token for the target integration.

## 6.3 Provider Abstraction

Changing the underlying KMS key (rotation), changing the region, or migrating to a different provider is a backend-only operation. The DynamoDB record is updated. No client-side changes. No re-encryption of SOPS files. The `clef:int_abc123/production` identifier in every encrypted file continues to work — it resolves to whatever the current mapping says.

This is a significant operational advantage. Today, rotating an AWS KMS key requires `sops updatekeys` on every encrypted file. With Clef key IDs, the Cloud backend updates the mapping and all subsequent operations use the new key transparently.

## 6.4 Auditability

The DynamoDB mapping provides a single source of truth for which Clef key ID maps to which provider key, with creation timestamps, rotation timestamps, and status tracking. Combined with CloudTrail logging on the AWS KMS operations, this creates a complete audit trail from Clef key ID to provider operation.

# 7. Future: Multi-Provider

The DynamoDB schema includes a `provider` field. When GCP KMS or Azure Key Vault support is added:

1. Cloud API provisions a key in the target provider.
2. Mapping record is created with `provider: "gcp"` (or `"azure"`) and the provider-specific resource identifier.
3. Resolution flow routes to the correct SDK based on `provider`.
4. Client-side code is unchanged — the key ID is still `clef:int_abc123/production`.

The keyservice proto already supports `GcpKmsKey`, `AzureKeyVaultKey`, etc. via the `Key` oneof. For now these return `UNIMPLEMENTED`. The architecture allows routing different providers through the same `KmsKey.arn` field or through their native key type fields in the future, without changing the client contract.

# 8. Architectural Decisions

## 8.1 Reuse KmsKey.arn vs. New Proto Key Type (Decided: Reuse arn)

The SOPS proto defines `KmsKey.arn` as a string. Adding a new key type (e.g., `ClefKey`) would require forking the proto, which means forking SOPS's key service implementation. The `arn` field accepts any string. The keyservice already controls what happens with it. The semantic mismatch (field called `arn`, value is not an ARN) is cosmetic and internal to the wire protocol.

The rejected alternative — forking the proto — would create a maintenance burden for every SOPS version upgrade and break compatibility with unmodified SOPS binaries.

## 8.2 Clef Key ID vs. Opaque UUID (Decided: Clef Key ID)

A UUID (`550e8400-e29b-41d4-a716-446655440000`) would be globally unique without scoping, but it is opaque — a developer inspecting an encrypted file cannot tell what it refers to. The `clef:int_abc123/production` format is self-describing: the integration scope and key purpose are visible. Debuggability wins over format purity.

## 8.3 Resolution at Cloud API vs. at Keyservice (Decided: Cloud API)

The keyservice could resolve Clef key IDs to AWS ARNs locally (via a config file or API call). But this would require the keyservice to have access to the mapping, adding a dependency and a cache invalidation problem. The Cloud API already authenticates the request and has access to DynamoDB. Resolution at the API keeps the keyservice stateless — it forwards strings and receives responses. This is simpler to operate, test, and reason about.

## 8.4 Wire Compatibility Strategy (Decided: Keep keyArn, Rename Internally)

The JSON field `keyArn` in the Cloud API is a public contract. Renaming it to `keyId` would break existing deployments. The Go struct field `KeyARN` is an internal name. Renaming it to `KeyID` improves code clarity without affecting the wire format. A future v2 API can use `keyId` as the JSON field name, with the v1 endpoint maintained for backward compatibility.

# 9. Open Questions

1. **Key rotation UX.** When the Cloud backend rotates the underlying AWS KMS key, should the user be notified? The operation is transparent (the Clef key ID doesn't change), but some compliance frameworks require notification of key rotation events.

2. **Multi-key per integration.** The schema supports multiple key aliases per integration. Should `clef cloud init` create a single key (MVP) or allow the user to create multiple keys for different environments? The format supports it (`clef:int_abc123/production`, `clef:int_abc123/staging`), but multi-environment Cloud is explicitly out of MVP scope.

3. **Key alias immutability.** Once a key alias is assigned and written into SOPS files, renaming it would break all those files. Should aliases be immutable after creation? Or should the Cloud API support alias migration (old alias redirects to new alias for a transition period)?
