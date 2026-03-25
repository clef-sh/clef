# Clef KMS Auditor — Implementation Plan

## Overview

A zero-backend, open-source SPA that audits cloud KMS configurations for SOC 2 evidence. Runs entirely in the browser. Served from `audit.clef.sh`. No data ever leaves the client. Acts as a loss-leader GTM tool that funnels users toward Clef Pro.

**Repo:** `clef-sh/kms-auditor`

---

## Tech Stack

| Layer                  | Choice                                                      | Rationale                                                                |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Framework              | Astro 5 + Islands                                           | Same as clef-sh/www, SSG with interactive islands only where needed      |
| UI                     | Tailwind v4 + Clef design system                            | Reuse tokens from clef-sh/www (gold accent #f0a500, DM Sans, dark theme) |
| Interactive components | Svelte or Preact islands                                    | Lightweight, no full framework needed for a few interactive panels       |
| Cloud SDKs             | AWS SDK v3 (browser), Google APIs (REST), Azure MSAL + REST | All support browser bundles                                              |
| PDF generation         | jsPDF + jsPDF-AutoTable                                     | Client-side PDF, no server                                               |
| CSV generation         | Manual string building                                      | Same pattern as Clef Pro export                                          |
| Hosting                | Cloudflare Pages                                            | Free, global CDN, same as clef-sh OSS site                               |
| CI                     | GitHub Actions                                              | Lint, type-check, build on PR                                            |

---

## Prerequisites

### App registrations needed before Phase 3-4:

**GCP OAuth Client (for GCP Cloud KMS audit):**

1. Create a GCP project under a Clef-owned account (e.g. `clef-kms-auditor`)
2. Enable Cloud KMS API and Cloud Logging API
3. Go to APIs & Services → Credentials → Create OAuth 2.0 Client ID
4. Type: Web application
5. Redirect URI: `https://audit.clef.sh/callback`
6. Scopes: `https://www.googleapis.com/auth/cloudkms.readonly`, `https://www.googleapis.com/auth/logging.read`
7. Configure consent screen: app name "Clef KMS Auditor", logo, privacy policy link
8. The client ID goes into the SPA as a public constant (it's not a secret — it's visible in the browser)

**Azure AD App Registration (for Azure Key Vault audit):**

1. Register an app in Azure AD under a Clef-owned tenant
2. Redirect URI: `https://audit.clef.sh/callback` (SPA type)
3. API permissions: `https://vault.azure.net/.default` (delegated), `https://management.azure.com/user_impersonation` (delegated)
4. The application (client) ID goes into the SPA as a public constant

**AWS: No registration needed.** User provides temporary credentials directly via `aws sts get-session-token`.

**Trust model:** The OAuth tokens are extracted from the URL fragment in the browser — they never reach any Clef server. The app registrations are just the "who is asking" identity on the consent screen. CSP headers enforce that the browser can only talk to cloud provider API domains, not to any Clef backend.

---

## Project Structure

```
kms-auditor/
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── public/
│   ├── logo.svg                  # Clef treble clef (from clef-sh/www/public/clef.svg)
│   └── favicon.svg
├── src/
│   ├── layouts/
│   │   └── Layout.astro          # Shell: header, footer, dark theme
│   │
│   ├── pages/
│   │   ├── index.astro           # Landing: what this tool does, select provider
│   │   ├── audit.astro           # Main audit page (interactive island)
│   │   ├── callback.astro        # OAuth callback (GCP/Azure) — static, extracts token from fragment
│   │   └── about.astro           # How it works, trust model, open source link
│   │
│   ├── components/
│   │   ├── ProviderSelector.svelte    # AWS / GCP / Azure cards
│   │   ├── AuditWorkspace.svelte      # Main audit UI (auth → scan → report)
│   │   ├── CredentialForm.svelte      # Per-provider auth forms
│   │   ├── ScanProgress.svelte        # Progress indicator during scan
│   │   ├── AuditReport.svelte         # Results view with tabs
│   │   ├── KeyInventoryTable.svelte   # Key list with metadata
│   │   ├── ComplianceChecks.svelte    # Pass/fail policy checks
│   │   ├── AccessTimeline.svelte      # Who accessed what when
│   │   ├── ExportButtons.svelte       # CSV + PDF download
│   │   └── ClefCloudCTA.svelte        # Upsell banner
│   │
│   ├── lib/
│   │   ├── types.ts                   # Shared types
│   │   │
│   │   ├── providers/
│   │   │   ├── interface.ts           # Provider adapter interface
│   │   │   ├── aws.ts                 # AWS KMS + CloudTrail adapter
│   │   │   ├── gcp.ts                 # GCP Cloud KMS + Audit Logs adapter
│   │   │   └── azure.ts              # Azure Key Vault + Monitor adapter
│   │   │
│   │   ├── engine/
│   │   │   ├── scanner.ts            # Orchestrates the full scan
│   │   │   ├── key-inventory.ts      # Enumerate keys, aliases, metadata
│   │   │   ├── rotation-check.ts     # Rotation status and age
│   │   │   ├── access-audit.ts       # Parse audit logs for usage events
│   │   │   ├── policy-eval.ts        # Evaluate compliance rules
│   │   │   └── anomaly-detect.ts     # Unusual access patterns
│   │   │
│   │   ├── export/
│   │   │   ├── csv.ts                # CSV generation
│   │   │   └── pdf.ts               # PDF generation with jsPDF
│   │   │
│   │   └── store.ts                  # Svelte stores for scan state
│   │
│   └── styles/
│       └── global.css                # Clef design tokens
```

---

## Provider Adapter Interface

```typescript
// src/lib/providers/interface.ts

interface KMSKey {
  id: string;
  alias?: string;
  region: string;
  algorithm: string;
  state: "enabled" | "disabled" | "pendingDeletion" | "pendingImport";
  createdAt: Date;
  rotationEnabled: boolean;
  lastRotatedAt: Date | null;
  rotationPeriodDays: number | null;
  keyManager: "customer" | "provider";
  description?: string;
}

interface AccessEvent {
  timestamp: Date;
  principal: string;
  action: string;
  keyId: string;
  sourceIp?: string;
  userAgent?: string;
  success: boolean;
}

interface ProviderAdapter {
  name: string;
  authenticate(credentials: unknown): Promise<void>;
  isAuthenticated(): boolean;
  listRegions(): Promise<string[]>;
  listKeys(region: string): Promise<KMSKey[]>;
  getAccessEvents(keyId: string, startDate: Date, endDate: Date): Promise<AccessEvent[]>;
  disconnect(): void;
}
```

---

## AWS Adapter

**Auth:** User provides temporary credentials (access key + secret + session token) from `aws sts get-session-token`. The SPA shows a copyable command to generate these.

**Required IAM permissions (read-only):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kms:ListKeys",
        "kms:ListAliases",
        "kms:DescribeKey",
        "kms:GetKeyRotationStatus",
        "kms:GetKeyPolicy",
        "cloudtrail:LookupEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

**SDK imports (tree-shaken, browser-compatible):**

- `@aws-sdk/client-kms` — ListKeysCommand, DescribeKeyCommand, GetKeyRotationStatusCommand, ListAliasesCommand
- `@aws-sdk/client-cloudtrail` — LookupEventsCommand
- `@aws-sdk/client-sts` — AssumeRoleCommand (optional, for advanced role assumption)

---

## GCP Adapter

**Auth:** Google Identity Services (client-side OAuth). Uses the Clef-registered OAuth client ID. Scopes: `cloudkms.readonly` + `logging.read`.

**API calls (REST, no SDK):**

- `GET cloudkms.googleapis.com/v1/projects/{project}/locations/-/keyRings`
- `GET cloudkms.googleapis.com/v1/{keyRing}/cryptoKeys`
- `GET cloudkms.googleapis.com/v1/{cryptoKey}`
- `GET cloudkms.googleapis.com/v1/{cryptoKey}/cryptoKeyVersions`
- `POST logging.googleapis.com/v2/entries:list` (with KMS audit log filter)

---

## Azure Adapter

**Auth:** MSAL.js browser flow. Uses the Clef-registered Azure AD app client ID. Scopes: `vault.azure.net/.default` + `management.azure.com/user_impersonation`.

**API calls:**

- `@azure/keyvault-keys` — list keys, get key properties, get key rotation policy
- `@azure/monitor-query` — query Activity Logs for key vault operations
- Or REST: `GET https://{vault}.vault.azure.net/keys?api-version=7.4`

---

## Audit Engine

### Scanner orchestration

```
1. Authenticate with selected provider
2. Discover regions/locations
3. For each region/location:
   a. List all keys → key-inventory.ts
   b. Check rotation status per key → rotation-check.ts
   c. Query audit logs for past N days → access-audit.ts
4. Evaluate compliance rules → policy-eval.ts
5. Detect anomalies → anomaly-detect.ts
6. Aggregate into report structure
```

### Compliance Rules

| Rule ID            | Check                       | Default                            | Severity |
| ------------------ | --------------------------- | ---------------------------------- | -------- |
| `rotation-enabled` | Auto-rotation enabled       | Required for customer-managed keys | Critical |
| `rotation-age`     | Key material age            | Max 365 days                       | Warning  |
| `disabled-keys`    | Keys in disabled state      | Warn if > 0                        | Warning  |
| `pending-deletion` | Keys scheduled for deletion | Info                               | Info     |
| `no-alias`         | Keys without aliases        | Warn                               | Warning  |
| `unused-keys`      | No access events in N days  | 90 days                            | Warning  |
| `single-principal` | Only one principal uses key | Info (bus factor)                  | Info     |
| `cross-account`    | Access from outside account | Warn                               | Warning  |
| `high-frequency`   | Usage spike                 | > 2x 30-day average                | Warning  |

---

## Report Output

### CSV files (3 separate downloads)

**Keys CSV:**

```
keyId,alias,region,algorithm,state,createdAt,rotationEnabled,lastRotatedAt,
rotationAgeDays,keyManager,description,complianceStatus,violations
```

**Access CSV:**

```
timestamp,keyId,keyAlias,action,principal,sourceIp,userAgent,success
```

**Compliance CSV:**

```
ruleId,ruleName,keyId,keyAlias,passed,severity,message
```

### PDF structure

```
Page 1: Executive summary
  - Provider, account/project, scan date, date range
  - Total keys, compliant, non-compliant
  - Top violations

Page 2-N: Key inventory table
  - Color-coded compliance status per key

Page N+1: Compliance detail
  - Each rule with pass/fail per key, severity, recommendation

Page N+2: Access audit summary
  - Unique principals, total events, date range
  - Top accessed keys, anomalies detected

Final page:
  - "Generated by Clef KMS Auditor (audit.clef.sh)"
  - "For continuous secrets governance, visit clef.sh"
```

---

## UI Flow

### Landing page

Provider selection cards (AWS / GCP / Azure) with "Start Audit" button. Brief explanation of what the tool does and the trust model ("runs in your browser, no data sent").

### Audit workspace (3 steps)

**Step 1: Authenticate**

- AWS: text inputs for access key, secret, session token + copyable `aws sts` command
- GCP: "Sign in with Google" button → consent screen → redirect back
- Azure: "Sign in with Microsoft" button → consent screen → redirect back
- Permission verification before proceeding

**Step 2: Scan**

- Region/location multi-select
- Live progress: "Scanning us-east-1... 47 keys found"
- Cancel button

**Step 3: Results**

- Tab bar: Overview | Keys | Compliance | Access | Export
- Overview: stat cards (total keys, compliant %, violations by severity)
- Keys: sortable/filterable table with health badges
- Compliance: rule-by-rule with expandable key lists
- Access: timeline + table
- Export: 3x CSV buttons + PDF button

### Clef Pro CTA (bottom of results)

```
Your KMS audit is complete. This covers key lifecycle and access controls.

For continuous governance of encrypted secrets in git — rotation policies,
drift detection, and compliance alerts on every commit — try Clef Pro.

[Try Clef Pro →]  [Learn more]
```

---

## Security

1. **No credentials stored.** All tokens live in JS memory. Garbage collected on tab close. No localStorage, sessionStorage, or cookies.
2. **No calls to Clef servers.** After page load, all network goes to cloud provider APIs only.
3. **CSP headers.** `connect-src` restricted to `*.amazonaws.com *.googleapis.com *.azure.net *.microsoft.com *.windows.net`.
4. **SRI hashes.** All JS bundles served with subresource integrity.
5. **Open source.** MIT license. Customers can fork, audit, self-host.

---

## Implementation Phases

### Phase 1: Scaffold + AWS adapter (1-2 weeks)

- Project setup: Astro, Tailwind, Clef design system
- Landing page, audit page shell, about page
- AWS credential form (temporary credentials)
- AWS adapter: ListKeys, DescribeKey, GetKeyRotationStatus, ListAliases
- Key inventory table + rotation check
- CSV export (keys + compliance)
- Deploy to Cloudflare Pages

### Phase 2: Audit logs + PDF (1 week)

- CloudTrail LookupEvents integration
- Access timeline component
- Anomaly detection (unused keys, high frequency)
- PDF report generation with jsPDF
- All 9 compliance rules implemented

### Phase 3: GCP adapter (1 week)

- **Prerequisite: GCP OAuth client registration (see Prerequisites section)**
- GCP OAuth flow (client-side)
- Cloud KMS REST API integration
- Cloud Audit Logs integration
- OAuth callback page
- Test with real GCP projects

### Phase 4: Azure adapter (1 week)

- **Prerequisite: Azure AD app registration (see Prerequisites section)**
- MSAL.js auth flow
- Key Vault REST API integration
- Activity Logs integration
- Test with real Azure subscriptions

### Phase 5: Polish + GTM (1 week)

- Clef Pro CTA integration
- About page (trust model, open source, security details)
- SEO: meta tags, structured data for "KMS audit tool" queries
- Blog post: "How to audit your KMS for SOC 2"
- README with screenshots
- Product Hunt / HN launch prep

---

## SOC 2 Coverage

What the generated report covers:

| Control              | Evidence provided                                                      |
| -------------------- | ---------------------------------------------------------------------- |
| Key inventory        | All KMS keys with algorithm, creation date, state                      |
| Key rotation         | Auto-rotation enabled/disabled, last rotation date, age                |
| Key lifecycle        | Creation → enabled → disabled → scheduled deletion                     |
| Access control       | Who accessed which keys, when, from what principal/IP                  |
| Separation of duties | Which IAM roles/users have admin vs usage permissions                  |
| Anomaly detection    | Unusual access patterns (new principal, high frequency, cross-account) |

What it does NOT cover (Clef Pro's territory):

| Gap                                                | Clef Pro solution                  |
| -------------------------------------------------- | ---------------------------------- |
| Are secrets in git using these KMS keys correctly? | Secret file matrix                 |
| Are environments in sync?                          | Drift detection                    |
| Are rotation policies enforced on every commit?    | Policy results + alerts            |
| Continuous monitoring (not point-in-time)          | CI-integrated report on every push |
| Alert history and acknowledgement workflow         | Alert lifecycle with notifications |
