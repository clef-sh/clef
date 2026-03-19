# GCP KMS

[Google Cloud Key Management Service (KMS)](https://cloud.google.com/kms) provides cloud-managed encryption keys with IAM-based access control. SOPS uses the KMS key to encrypt and decrypt the data key that protects your secrets.

## When to use GCP KMS

- Your team is hosted on Google Cloud and already uses GCP IAM
- You need centralised key management with audit logging
- You want to manage access to secrets through GCP IAM roles
- Your organisation requires cloud-managed HSM-backed keys

For simpler setups without cloud dependencies, use [age](/backends/age) instead.

## Prerequisites

- A **GCP project** with the Cloud KMS API enabled
- **gcloud CLI** installed and authenticated (`gcloud auth application-default login`)
- A **KMS keyring and key** created in the project

### Enable the Cloud KMS API

```bash
gcloud services enable cloudkms.googleapis.com
```

### Create a keyring and key

```bash
# Create a keyring
gcloud kms keyrings create clef-keyring \
  --location global

# Create a key within the keyring
gcloud kms keys create clef-secrets-key \
  --keyring clef-keyring \
  --location global \
  --purpose encryption
```

The resource ID for the key follows this format:

```
projects/my-project/locations/global/keyRings/clef-keyring/cryptoKeys/clef-secrets-key
```

## Manifest configuration

### Per-environment override (recommended)

The most common pattern is age for dev/staging and GCP KMS for production:

```yaml
version: 1

environments:
  - name: dev
    description: Local development
  - name: staging
    description: Staging environment
  - name: production
    description: Production environment
    protected: true
    sops:
      backend: gcpkms
      gcp_kms_resource_id: "projects/my-project/locations/global/keyRings/clef-keyring/cryptoKeys/clef-secrets-key"

namespaces:
  - name: database
    description: Database credentials
  - name: payments
    description: Payment provider secrets

sops:
  default_backend: age

file_pattern: "secrets/{namespace}/{environment}.enc.yaml"
```

Dev and staging use the global default (age); production uses GCP KMS. See [Per-environment SOPS override](/guide/manifest#per-environment-sops-override) for details.

### All environments with KMS

To use GCP KMS for all environments:

```yaml
version: 1

environments:
  - name: dev
    description: Local development
  - name: staging
    description: Staging environment
  - name: production
    description: Production environment
    protected: true

namespaces:
  - name: database
    description: Database credentials
  - name: payments
    description: Payment provider secrets

sops:
  default_backend: gcpkms
  gcp_kms_resource_id: "projects/my-project/locations/global/keyRings/clef-keyring/cryptoKeys/clef-secrets-key"

file_pattern: "secrets/{namespace}/{environment}.enc.yaml"
```

## IAM permissions

The service account or user running Clef needs `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the KMS key:

```bash
gcloud kms keys add-iam-policy-binding clef-secrets-key \
  --keyring clef-keyring \
  --location global \
  --member "user:developer@example.com" \
  --role "roles/cloudkms.cryptoKeyEncrypterDecrypter"
```

## Example workflow

```bash
# Ensure GCP credentials are configured
gcloud auth application-default login

# Initialise Clef with GCP KMS
clef init --namespaces database,auth --backend gcpkms --non-interactive

# Set a secret
clef set database/dev DB_PASSWORD mydevpassword

# Retrieve the secret
clef get database/dev DB_PASSWORD
```

## Access control

GCP KMS provides IAM-based access control:

- **Grant access:** Assign the `cryptoKeyEncrypterDecrypter` role to a user or service account
- **Revoke access:** Remove the IAM binding — decryption is immediately denied
- **Audit:** Cloud Audit Logs track all KMS operations

## See also

- [age](/backends/age) — simpler alternative without cloud dependencies
- [AWS KMS](/backends/aws-kms) — similar cloud-managed approach for AWS
- [clef init](/cli/init) — initialising with a KMS backend
