[**@clef-sh/core**](../index.md)

---

[@clef-sh/core](../index.md) / ServiceIdentityManager

# Class: ServiceIdentityManager

Defined in: packages/core/src/service-identity/manager.ts:23

Manages service identities: creation, listing, key rotation, and drift validation.

## Example

```ts
const manager = new ServiceIdentityManager(sopsClient, matrixManager);
const result = await manager.create("api-gw", ["api"], "API gateway", manifest, repoRoot);
```

## Constructors

### Constructor

```ts
new ServiceIdentityManager(encryption, matrixManager): ServiceIdentityManager;
```

Defined in: packages/core/src/service-identity/manager.ts:24

#### Parameters

| Parameter       | Type                                                      |
| --------------- | --------------------------------------------------------- |
| `encryption`    | [`EncryptionBackend`](../interfaces/EncryptionBackend.md) |
| `matrixManager` | [`MatrixManager`](MatrixManager.md)                       |

#### Returns

`ServiceIdentityManager`

## Methods

### create()

```ts
create(
   name,
   namespaces,
   description,
   manifest,
   repoRoot): Promise<{
  identity: ServiceIdentityDefinition;
  privateKeys: Record<string, string>;
}>;
```

Defined in: packages/core/src/service-identity/manager.ts:35

Create a new service identity with per-environment age key pairs.
Generates keys, updates the manifest, and registers public keys as SOPS recipients.

#### Parameters

| Parameter     | Type                                            |
| ------------- | ----------------------------------------------- |
| `name`        | `string`                                        |
| `namespaces`  | `string`[]                                      |
| `description` | `string`                                        |
| `manifest`    | [`ClefManifest`](../interfaces/ClefManifest.md) |
| `repoRoot`    | `string`                                        |

#### Returns

`Promise`\<\{
`identity`: [`ServiceIdentityDefinition`](../interfaces/ServiceIdentityDefinition.md);
`privateKeys`: `Record`\<`string`, `string`\>;
\}\>

The created identity definition and the per-environment private keys (printed once).

---

### get()

```ts
get(manifest, name):
  | ServiceIdentityDefinition
  | undefined;
```

Defined in: packages/core/src/service-identity/manager.ts:107

Get a single service identity by name.

#### Parameters

| Parameter  | Type                                            |
| ---------- | ----------------------------------------------- |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) |
| `name`     | `string`                                        |

#### Returns

\| [`ServiceIdentityDefinition`](../interfaces/ServiceIdentityDefinition.md)
\| `undefined`

---

### list()

```ts
list(manifest): ServiceIdentityDefinition[];
```

Defined in: packages/core/src/service-identity/manager.ts:100

List all service identities from the manifest.

#### Parameters

| Parameter  | Type                                            |
| ---------- | ----------------------------------------------- |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) |

#### Returns

[`ServiceIdentityDefinition`](../interfaces/ServiceIdentityDefinition.md)[]

---

### registerRecipients()

```ts
registerRecipients(
   identity,
   manifest,
repoRoot): Promise<void>;
```

Defined in: packages/core/src/service-identity/manager.ts:114

Register a service identity's public keys as SOPS recipients on scoped matrix files.

#### Parameters

| Parameter  | Type                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| `identity` | [`ServiceIdentityDefinition`](../interfaces/ServiceIdentityDefinition.md) |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md)                           |
| `repoRoot` | `string`                                                                  |

#### Returns

`Promise`\<`void`\>

---

### rotateKey()

```ts
rotateKey(
   name,
   manifest,
   repoRoot,
environment?): Promise<Record<string, string>>;
```

Defined in: packages/core/src/service-identity/manager.ts:139

Rotate the age key for a service identity (all envs or a specific env).
Returns the new private keys.

#### Parameters

| Parameter      | Type                                            |
| -------------- | ----------------------------------------------- |
| `name`         | `string`                                        |
| `manifest`     | [`ClefManifest`](../interfaces/ClefManifest.md) |
| `repoRoot`     | `string`                                        |
| `environment?` | `string`                                        |

#### Returns

`Promise`\<`Record`\<`string`, `string`\>\>

---

### validate()

```ts
validate(manifest, repoRoot): Promise<ServiceIdentityDriftIssue[]>;
```

Defined in: packages/core/src/service-identity/manager.ts:198

Validate service identities and return drift issues.

#### Parameters

| Parameter  | Type                                            |
| ---------- | ----------------------------------------------- |
| `manifest` | [`ClefManifest`](../interfaces/ClefManifest.md) |
| `repoRoot` | `string`                                        |

#### Returns

`Promise`\<[`ServiceIdentityDriftIssue`](../interfaces/ServiceIdentityDriftIssue.md)[]\>
