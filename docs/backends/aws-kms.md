# AWS KMS

[AWS Key Management Service (KMS)](https://aws.amazon.com/kms/) provides cloud-managed encryption keys with IAM-based access control. SOPS uses the KMS key to encrypt and decrypt the data key that protects your secrets.

## When to use AWS KMS

- Your team is hosted on AWS and already uses IAM for access control
- You need centralised key management with audit logging via CloudTrail
- You want to grant or revoke access to secrets through IAM policies without rotating key files
- Your organisation requires HSM-backed encryption keys

For simpler setups without cloud dependencies, use [age](/backends/age) instead.

## Prerequisites

- An **AWS account** with permissions to create and use KMS keys
- **AWS CLI** installed and configured with credentials (`aws configure`)
- A **KMS key** created in the AWS Console or via the CLI

### Create a KMS key

```bash
aws kms create-key --description "Clef secrets encryption key"
```

Note the `KeyId` or `Arn` from the output. You will need the full ARN:

```
arn:aws:kms:us-east-1:123456789012:key/abcd1234-5678-90ab-cdef-ghijklmnopqr
```

### Create an alias (optional but recommended)

```bash
aws kms create-alias \
  --alias-name alias/clef-secrets \
  --target-key-id abcd1234-5678-90ab-cdef-ghijklmnopqr
```

## Manifest configuration

In your `clef.yaml`:

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
  default_backend: awskms
  aws_kms_arn: "arn:aws:kms:us-east-1:123456789012:key/abcd1234-5678-90ab-cdef-ghijklmnopqr"

file_pattern: "{namespace}/{environment}.enc.yaml"
```

## IAM policy

The IAM user or role that runs Clef needs `kms:Encrypt`, `kms:Decrypt`, and `kms:GenerateDataKey` permissions on the KMS key:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
      "Resource": "arn:aws:kms:us-east-1:123456789012:key/abcd1234-5678-90ab-cdef-ghijklmnopqr"
    }
  ]
}
```

Attach this policy to the IAM users or roles that need to encrypt or decrypt secrets.

## Example workflow

```bash
# Ensure AWS credentials are configured
aws sts get-caller-identity

# Initialise Clef with AWS KMS
clef init --namespaces database,auth --backend awskms --non-interactive

# Set a secret (SOPS encrypts using the KMS key)
clef set database/dev DB_PASSWORD mydevpassword

# Retrieve the secret (SOPS decrypts using the KMS key)
clef get database/dev DB_PASSWORD
```

## Multiple regions

For cross-region redundancy, you can configure multiple KMS keys in your `.sops.yaml`. SOPS encrypts the data key with each KMS key, so decryption works from any region:

```yaml
creation_rules:
  - path_regex: ".*\\.enc\\.yaml$"
    kms: "arn:aws:kms:us-east-1:123456789012:key/key1,arn:aws:kms:eu-west-1:123456789012:key/key2"
```

## Access control

The primary advantage of AWS KMS over age is IAM-based access control:

- **Grant access:** Attach the KMS policy to a user or role
- **Revoke access:** Remove the policy — the user immediately loses the ability to decrypt
- **Audit:** CloudTrail logs every KMS API call, providing a full audit trail of who decrypted what and when

No key files need to be generated, distributed, or rotated.

## See also

- [age](/backends/age) — simpler alternative for teams without AWS
- [GCP KMS](/backends/gcp-kms) — similar cloud-managed approach for GCP
- [clef init](/cli/init) — initialising with a KMS backend
