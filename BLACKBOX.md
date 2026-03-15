# Clef Blackbox Test Suite

## Purpose

This document is an executable prompt. When fed to an AI agent (Claude Code), it drives a
complete blackbox validation of the Clef CLI. The test uses **only public-facing
documentation** (README, `docs/` site, `--help` output) to derive expected behaviour, then
executes real `clef` commands in a temporary git repository and compares actual output against
documented expectations.

The test simulates the full secrets-management lifecycle of **Acme Engineering**, a fictional
company whose 3-tier web application sells TNT and Anvils.

---

## Instructions for the Executing Agent

You are the test executor. Follow the phases below in order. Parallelise where indicated.
All shell commands run against a real directory on the host machine. **Do not read source
code** — this is a blackbox test. You may only reference files under `docs/`, the root
`README.md`, and CLI `--help` output.

### Environment Setup

1. Ensure `clef` is available. Run: `npx @clef-sh/cli --version` from the monorepo root
   (`/Users/jamesspears/GitHub/driftmapper/clef-sh`). If that fails, try
   `node packages/cli/dist/index.js --version` or `npm link -w packages/cli && clef --version`.
   Record the version.

2. Create the test workspace:

   ```bash
   TEST_ROOT="/Users/jamesspears/GitHub/driftmapper/clef-sh/.blackbox-runs"
   RUN_DIR="$TEST_ROOT/run-$(date +%Y%m%d-%H%M%S)"
   mkdir -p "$RUN_DIR"
   ```

3. Append `.blackbox-runs/` to `.gitignore` if not already present.

4. Inside `$RUN_DIR`, initialise a fresh git repo:

   ```bash
   cd "$RUN_DIR"
   git init
   git commit --allow-empty -m "initial commit"
   ```

5. Create a test report file at `$RUN_DIR/REPORT.md`. All findings are appended here.

---

## Phase 1 — Documentation Discovery (Parallelisable)

Launch parallel agents to read the public documentation and extract the expected interface
for every command. Each agent produces a structured summary that Phase 2 will consume.

### Agent 1A: CLI Interface Extraction

Read every file under `docs/cli/*.md` and the root `README.md`. For each of the 19 commands
(init, update, get, set, delete, diff, lint, rotate, recipients, hooks, exec, export, import,
scan, doctor, merge-driver, service, bundle, ui), extract:

- **Syntax** (positional args + flags)
- **Exit codes** and their meanings
- **Expected stdout patterns** (success messages, table formats, JSON shapes)
- **Error cases** documented
- **Subcommands** (for recipients, service, hooks)

Compile into a structured reference: `$RUN_DIR/cli-interface.md`.

### Agent 1B: Lifecycle & Concepts Extraction

Read `docs/guide/quick-start.md`, `docs/guide/concepts.md`, `docs/guide/manifest.md`,
`docs/guide/key-storage.md`, `docs/guide/team-setup.md`, `docs/guide/service-identities.md`,
`docs/guide/pending-values.md`, and `docs/guide/scanning.md`.

Extract:

- The documented lifecycle order (init → set → get → diff → lint → ui)
- Manifest schema (version, environments, namespaces, sops, file_pattern, service_identities)
- Key storage resolution order
- Team member add/remove workflow
- Service identity create → bundle → rotate lifecycle
- Pending values workflow

Compile into: `$RUN_DIR/lifecycle-reference.md`.

### Agent 1C: Help Text Validation

For every command, run `clef <command> --help` (or `clef <command> <subcommand> --help`) and
capture the output. Compare against the docs from Agent 1A. Flag any discrepancies between
`--help` text and the documentation site. Record in `$RUN_DIR/help-discrepancies.md`.

---

## Phase 2 — Test Case Construction

Using the outputs of Phase 1, construct the test matrix below. Each test case has:

- **ID**: `TC-NNN`
- **Category**: One of `init`, `crud`, `diff`, `lint`, `scan`, `recipients`, `rotation`,
  `service-identity`, `bundle`, `exec`, `export`, `import`, `hooks`, `doctor`, `update`,
  `delete`, `lifecycle`, `error-handling`
- **Doc Reference**: The specific docs page and section the expectation is derived from
- **Command**: The exact shell command to run
- **Expected**: Exit code, stdout pattern, filesystem side-effect
- **Actual**: Filled in during Phase 3
- **Status**: PASS / FAIL / SKIP / BLOCKED

### Acme Engineering Scenario

Acme Engineering's 3-tier web app has these namespaces:

| Namespace  | Description            | Keys                                                       |
| ---------- | ---------------------- | ---------------------------------------------------------- |
| `database` | PostgreSQL credentials | `DB_HOST`, `DB_PORT`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`   |
| `api`      | Backend API secrets    | `API_KEY`, `API_SECRET`, `JWT_SECRET`, `CORS_ORIGIN`       |
| `payments` | Stripe integration     | `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY`, `WEBHOOK_SECRET` |

Environments: `dev`, `staging`, `production` (production is protected).

Team members:

- **Alice** — lead engineer (initial key, created at init time)
- **Bob** — new hire joining mid-lifecycle (added via `recipients add`)

Service identities:

- **tnt-api** — scoped to `api` namespace (single-namespace)
- **anvil-worker** — scoped to `api,database` namespaces (multi-namespace)

---

### Test Cases

#### TC-001 to TC-010: Initialization & Doctor

| ID     | Command                                                                                                                                                                             | Expected                                                                                                                  | Doc Reference                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| TC-001 | `clef doctor` (before init)                                                                                                                                                         | Exit 1 — manifest not found                                                                                               | `docs/cli/doctor.md` "checks" table                 |
| TC-002 | `clef init --namespaces database,api,payments --non-interactive`                                                                                                                    | Exit 0 — creates `clef.yaml`, `.sops.yaml`, `secrets/` dir with 9 `.enc.yaml` files, `.clef/config.yaml`, pre-commit hook | `docs/cli/init.md` "Basic initialisation"           |
| TC-003 | Verify `clef.yaml` contains `version: 1`, 3 environments (dev/staging/production), 3 namespaces, `sops.default_backend: age`, `file_pattern` with `{namespace}` and `{environment}` | Manifest is valid YAML matching documented schema                                                                         | `docs/guide/manifest.md` "Full annotated example"   |
| TC-004 | Verify `secrets/` directory has 9 files: `{database,api,payments}/{dev,staging,production}.enc.yaml`                                                                                | All 9 matrix cells exist                                                                                                  | `docs/guide/concepts.md` "The two-axis model"       |
| TC-005 | Verify `.sops.yaml` exists                                                                                                                                                          | File present                                                                                                              | `docs/cli/init.md` step 2                           |
| TC-006 | Verify `.clef/config.yaml` exists with `age_keychain_label`                                                                                                                         | Contains label field                                                                                                      | `docs/guide/key-storage.md` "Per-repo labeled keys" |
| TC-007 | Verify `.git/hooks/pre-commit` exists                                                                                                                                               | Hook file is present and executable                                                                                       | `docs/cli/init.md` step 5                           |
| TC-008 | `clef doctor` (after init)                                                                                                                                                          | Exit 0 — all checks pass                                                                                                  | `docs/cli/doctor.md` "Output Format"                |
| TC-009 | `clef doctor --json`                                                                                                                                                                | Valid JSON with `ok: true` for clef, sops, git, manifest, ageKey, sopsYaml                                                | `docs/cli/doctor.md` "JSON output"                  |
| TC-010 | `clef init --namespaces database --non-interactive` (re-run)                                                                                                                        | Idempotent — prints "Already initialised" or equivalent, exit 0                                                           | `docs/cli/init.md` "Already initialised"            |

#### TC-011 to TC-025: Set / Get / CRUD

| ID     | Command                                                      | Expected                             | Doc Reference                      |
| ------ | ------------------------------------------------------------ | ------------------------------------ | ---------------------------------- |
| TC-011 | `clef set database/dev DB_HOST localhost`                    | Exit 0 — value set                   | `docs/guide/quick-start.md` step 2 |
| TC-012 | `clef set database/dev DB_PORT 5432`                         | Exit 0                               | `docs/guide/quick-start.md`        |
| TC-013 | `clef set database/dev DB_PASSWORD devpass123`               | Exit 0                               | `docs/guide/quick-start.md`        |
| TC-014 | `clef set database/dev DB_NAME acme_dev`                     | Exit 0                               | `docs/cli/set.md`                  |
| TC-015 | `clef set database/dev DB_SSL true`                          | Exit 0                               | `docs/cli/set.md`                  |
| TC-016 | `clef get database/dev DB_HOST`                              | Exit 0 — stdout contains `localhost` | `docs/guide/quick-start.md` step 3 |
| TC-017 | `clef get database/dev DB_PORT`                              | Exit 0 — stdout contains `5432`      | `docs/cli/get.md`                  |
| TC-018 | `clef get database/dev NONEXISTENT`                          | Exit 1 — key not found               | `docs/cli/get.md` exit codes       |
| TC-019 | `clef set database/staging DB_HOST staging-db.internal`      | Exit 0                               |                                    |
| TC-020 | `clef set database/staging DB_PORT 5432`                     | Exit 0                               |                                    |
| TC-021 | `clef set database/staging DB_PASSWORD staging-secret`       | Exit 0                               |                                    |
| TC-022 | `clef set database/staging DB_NAME acme_staging`             | Exit 0                               |                                    |
| TC-023 | `clef set database/staging DB_SSL true`                      | Exit 0                               |                                    |
| TC-024 | `clef set database/production DB_HOST prod-db.acme.internal` | Exit 0                               |                                    |
| TC-025 | `clef set database/production DB_PORT 5432`                  | Exit 0                               |                                    |

#### TC-026 to TC-045: Full Namespace Population (api + payments)

Populate all 3 namespaces across all 3 environments. These are batched for efficiency.

**api namespace:**

| ID     | Target         | Key         | Value                    |
| ------ | -------------- | ----------- | ------------------------ |
| TC-026 | api/dev        | API_KEY     | acme-dev-key-001         |
| TC-027 | api/dev        | API_SECRET  | acme-dev-secret-001      |
| TC-028 | api/dev        | JWT_SECRET  | dev-jwt-super-secret     |
| TC-029 | api/dev        | CORS_ORIGIN | http://localhost:3000    |
| TC-030 | api/staging    | API_KEY     | acme-staging-key-001     |
| TC-031 | api/staging    | API_SECRET  | acme-staging-secret-001  |
| TC-032 | api/staging    | JWT_SECRET  | staging-jwt-secret       |
| TC-033 | api/staging    | CORS_ORIGIN | https://staging.acme.com |
| TC-034 | api/production | API_KEY     | acme-prod-key-001        |
| TC-035 | api/production | API_SECRET  | acme-prod-secret-001     |
| TC-036 | api/production | JWT_SECRET  | prod-jwt-ultra-secret    |
| TC-037 | api/production | CORS_ORIGIN | https://acme.com         |

**payments namespace:**

| ID     | Target              | Key               | Value                    |
| ------ | ------------------- | ----------------- | ------------------------ |
| TC-038 | payments/dev        | STRIPE_SECRET_KEY | sk_test_acme_dev_001     |
| TC-039 | payments/dev        | STRIPE_PUBLIC_KEY | pk_test_acme_dev_001     |
| TC-040 | payments/dev        | WEBHOOK_SECRET    | whsec_test_dev_001       |
| TC-041 | payments/staging    | STRIPE_SECRET_KEY | sk_test_acme_staging_001 |
| TC-042 | payments/staging    | STRIPE_PUBLIC_KEY | pk_test_acme_staging_001 |
| TC-043 | payments/staging    | WEBHOOK_SECRET    | whsec_test_staging_001   |
| TC-044 | payments/production | STRIPE_SECRET_KEY | sk_live_acme_prod_001    |
| TC-045 | payments/production | STRIPE_PUBLIC_KEY | pk_live_acme_prod_001    |

Note: `WEBHOOK_SECRET` is intentionally **missing** from `payments/production` for the
diff/lint tests.

#### TC-046 to TC-055: Production Database Completion + Pending Values

| ID     | Command                                                                                            | Expected                                      | Doc Reference                             |
| ------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| TC-046 | `clef set database/production DB_PASSWORD prod-ultra-secret`                                       | Exit 0                                        |                                           |
| TC-047 | `clef set database/production DB_NAME acme_production`                                             | Exit 0                                        |                                           |
| TC-048 | `clef set database/production DB_SSL true`                                                         | Exit 0                                        |                                           |
| TC-049 | `clef set payments/dev WEBHOOK_SECRET --random`                                                    | Exit 0 — creates a random pending value       | `docs/guide/concepts.md` "Pending values" |
| TC-050 | `clef get payments/dev WEBHOOK_SECRET`                                                             | Exit 0 — returns a value (random placeholder) |                                           |
| TC-051 | Verify roundtrip: `clef get database/dev DB_HOST` returns `localhost`                              | Exact value matches what was set              | `docs/cli/get.md` "raw output"            |
| TC-052 | Verify roundtrip: `clef get api/staging JWT_SECRET` returns `staging-jwt-secret`                   | Exact match                                   |                                           |
| TC-053 | Verify roundtrip: `clef get payments/production STRIPE_SECRET_KEY` returns `sk_live_acme_prod_001` | Exact match                                   |                                           |
| TC-054 | `clef get database/production DB_HOST`                                                             | Returns `prod-db.acme.internal`               |                                           |
| TC-055 | `clef get api/production CORS_ORIGIN`                                                              | Returns `https://acme.com`                    |                                           |

#### TC-056 to TC-065: Diff

| ID     | Command                                               | Expected                                                           | Doc Reference                       |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| TC-056 | `clef diff database dev staging`                      | Exit 1 — shows differences (DB_HOST, DB_PASSWORD, DB_NAME differ)  | `docs/cli/diff.md`                  |
| TC-057 | `clef diff database dev staging --show-identical`     | Exit 1 — includes DB_PORT and DB_SSL as identical                  | `docs/cli/diff.md` --show-identical |
| TC-058 | `clef diff database dev staging --json`               | Exit 1 — valid JSON with `namespace`, `envA`, `envB`, `rows` array | `docs/cli/diff.md` "JSON output"    |
| TC-059 | `clef diff payments dev production`                   | Exit 1 — WEBHOOK_SECRET missing in production                      | `docs/cli/diff.md` "missing" status |
| TC-060 | `clef diff database dev dev`                          | Exit 0 — no differences (same env compared to itself)              | Logical deduction                   |
| TC-061 | `clef diff api dev staging`                           | Exit 1 — shows key differences                                     |                                     |
| TC-062 | `clef diff api staging production`                    | Exit 1 — values differ                                             |                                     |
| TC-063 | `clef diff payments staging production`               | Exit 1 — WEBHOOK_SECRET missing + other keys differ                |                                     |
| TC-064 | `clef diff database staging production --show-values` | Exit 1 — shows plaintext values                                    | `docs/cli/diff.md` --show-values    |
| TC-065 | `clef diff payments dev staging --json`               | Valid JSON output                                                  |                                     |

#### TC-066 to TC-075: Lint

| ID     | Command            | Expected                                                            | Doc Reference                    |
| ------ | ------------------ | ------------------------------------------------------------------- | -------------------------------- |
| TC-066 | `clef lint`        | Exit 0 or warnings only (no schema configured, so no schema errors) | `docs/cli/lint.md`               |
| TC-067 | `clef lint --json` | Valid JSON with `issues` array and `fileCount`                      | `docs/cli/lint.md` "JSON output" |
| TC-068 | `clef lint --fix`  | Exit 0 — no files to scaffold (matrix is complete)                  | `docs/cli/lint.md` --fix         |

#### TC-069 to TC-078: Delete

| ID     | Command                                     | Expected                               | Doc Reference                   |
| ------ | ------------------------------------------- | -------------------------------------- | ------------------------------- |
| TC-069 | `clef set api/dev DEPRECATED_KEY old_value` | Exit 0 — set a key to later delete     |                                 |
| TC-070 | `clef get api/dev DEPRECATED_KEY`           | Exit 0 — returns `old_value`           |                                 |
| TC-071 | `clef delete api/dev DEPRECATED_KEY`        | Exit 0 — key deleted                   | `docs/cli/delete.md`            |
| TC-072 | `clef get api/dev DEPRECATED_KEY`           | Exit 1 — key not found                 |                                 |
| TC-073 | `clef set api/dev TEMP_KEY temp_val`        | Exit 0                                 |                                 |
| TC-074 | `clef set api/staging TEMP_KEY temp_val`    | Exit 0                                 |                                 |
| TC-075 | `clef set api/production TEMP_KEY temp_val` | Exit 0                                 |                                 |
| TC-076 | `clef delete api TEMP_KEY --all-envs`       | Exit 0 — deleted from all environments | `docs/cli/delete.md` --all-envs |
| TC-077 | `clef get api/dev TEMP_KEY`                 | Exit 1 — key not found                 |                                 |
| TC-078 | `clef get api/staging TEMP_KEY`             | Exit 1 — key not found                 |                                 |

#### TC-079 to TC-088: Export & Exec

| ID     | Command                                                          | Expected                                                   | Doc Reference                    |
| ------ | ---------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------- |
| TC-079 | `clef export database/dev`                                       | Exit 0 — stdout has `export DB_HOST='localhost'` etc.      | `docs/cli/export.md`             |
| TC-080 | `clef export database/dev --no-export`                           | Exit 0 — stdout has `DB_HOST='localhost'` without `export` | `docs/cli/export.md` --no-export |
| TC-081 | `clef exec database/dev -- env`                                  | Exit 0 — output includes `DB_HOST=localhost`               | `docs/cli/exec.md`               |
| TC-082 | `clef exec api/dev -- printenv API_KEY`                          | Exit 0 — prints `acme-dev-key-001`                         | `docs/cli/exec.md`               |
| TC-083 | `clef exec database/dev --only DB_HOST,DB_PORT -- env`           | Exit 0 — only DB_HOST and DB_PORT are injected             | `docs/cli/exec.md` --only        |
| TC-084 | `clef exec database/dev --prefix ACME_ -- printenv ACME_DB_HOST` | Exit 0 — prints `localhost`                                | `docs/cli/exec.md` --prefix      |
| TC-085 | `clef exec database/dev --also api/dev -- env`                   | Exit 0 — both database and api keys present                | `docs/cli/exec.md` --also        |
| TC-086 | `clef export api/staging`                                        | Exit 0 — contains `export API_KEY='acme-staging-key-001'`  |                                  |
| TC-087 | `clef export payments/dev --format env`                          | Exit 0                                                     | `docs/cli/export.md` --format    |
| TC-088 | `clef exec database/dev -- sh -c 'echo $DB_HOST'`                | Exit 0 — prints `localhost`                                |                                  |

#### TC-089 to TC-098: Import

| ID     | Command                                                                           | Expected                                    | Doc Reference                    |
| ------ | --------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------- |
| TC-089 | Create `$RUN_DIR/import-test.env` with `IMPORT_KEY_1=value1\nIMPORT_KEY_2=value2` | File exists                                 |                                  |
| TC-090 | `clef import api/dev $RUN_DIR/import-test.env --dry-run`                          | Exit 0 — shows "would import" for both keys | `docs/cli/import.md` --dry-run   |
| TC-091 | `clef import api/dev $RUN_DIR/import-test.env`                                    | Exit 0 — keys imported                      | `docs/cli/import.md`             |
| TC-092 | `clef get api/dev IMPORT_KEY_1`                                                   | Exit 0 — returns `value1`                   |                                  |
| TC-093 | `clef get api/dev IMPORT_KEY_2`                                                   | Exit 0 — returns `value2`                   |                                  |
| TC-094 | Create `$RUN_DIR/import-test.json` with `{"JSON_KEY": "json_value"}`              | File exists                                 |                                  |
| TC-095 | `clef import api/dev $RUN_DIR/import-test.json`                                   | Exit 0 — JSON_KEY imported                  | `docs/cli/import.md` JSON format |
| TC-096 | `clef get api/dev JSON_KEY`                                                       | Exit 0 — returns `json_value`               |                                  |
| TC-097 | `clef import api/dev $RUN_DIR/import-test.env --keys IMPORT_KEY_1`                | Exit 0 — only IMPORT_KEY_1 processed        | `docs/cli/import.md` --keys      |
| TC-098 | `clef import api/dev $RUN_DIR/import-test.env --prefix IMPORT_`                   | Exit 0 — only keys starting with IMPORT\_   | `docs/cli/import.md` --prefix    |

#### TC-099 to TC-105: Recipients (Team Management)

| ID     | Command                                                                        | Expected                                                    | Doc Reference                    |
| ------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------- |
| TC-099 | `clef recipients list`                                                         | Exit 0 — shows at least 1 recipient (Alice's key from init) | `docs/cli/recipients.md` list    |
| TC-100 | Generate a new age keypair for Bob (use age-keygen or clef's internal tooling) | Capture Bob's public key                                    | `docs/guide/team-setup.md`       |
| TC-101 | `clef recipients add <bob-public-key> --label "Bob"`                           | Exit 0 — re-encrypts files, Bob added                       | `docs/cli/recipients.md` add     |
| TC-102 | `clef recipients list`                                                         | Exit 0 — shows 2 recipients (Alice + Bob)                   |                                  |
| TC-103 | Verify Bob's key appears in output of `clef recipients list`                   | Key and label visible                                       |                                  |
| TC-104 | `clef recipients list -e production`                                           | Exit 0 — may show global or per-env recipients              | `docs/cli/recipients.md` -e flag |
| TC-105 | `clef recipients remove <bob-public-key>`                                      | Exit 0 — re-encrypts files, Bob removed                     | `docs/cli/recipients.md` remove  |

#### TC-106 to TC-112: Rotation

| ID     | Command                                               | Expected                                              | Doc Reference             |
| ------ | ----------------------------------------------------- | ----------------------------------------------------- | ------------------------- |
| TC-106 | Generate a new age keypair (rotation target key)      | Capture public key                                    |                           |
| TC-107 | `clef rotate database/dev --new-key <new-public-key>` | Exit 0 — file re-encrypted with new recipient         | `docs/cli/rotate.md`      |
| TC-108 | `clef get database/dev DB_HOST`                       | Exit 0 — still returns `localhost` (values preserved) | Rotation preserves values |
| TC-109 | `clef rotate api/staging --new-key <new-public-key>`  | Exit 0                                                |                           |
| TC-110 | `clef get api/staging API_KEY`                        | Exit 0 — still returns `acme-staging-key-001`         |                           |
| TC-111 | `clef lint`                                           | Exit 0 — repo healthy after rotation                  |                           |
| TC-112 | `clef doctor`                                         | Exit 0 — all checks pass after rotation               |                           |

#### TC-113 to TC-125: Service Identities

| ID     | Command                                                                                           | Expected                                                                   | Doc Reference                                        |
| ------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| TC-113 | `clef service create tnt-api --namespaces api --description "TNT API service"`                    | Exit 0 — prints private keys for dev/staging/production. Updates clef.yaml | `docs/cli/service.md` create                         |
| TC-114 | Verify `clef.yaml` now has `service_identities` section with `tnt-api`                            | YAML contains the identity                                                 | `docs/guide/service-identities.md` "Manifest schema" |
| TC-115 | `clef service list`                                                                               | Exit 0 — shows `tnt-api` with its namespace and environments               | `docs/cli/service.md` list                           |
| TC-116 | `clef service show tnt-api`                                                                       | Exit 0 — shows identity details                                            | `docs/cli/service.md` show                           |
| TC-117 | `clef service create anvil-worker --namespaces api,database --description "Anvil worker service"` | Exit 0 — multi-namespace identity created                                  | `docs/guide/service-identities.md` "Multi-namespace" |
| TC-118 | `clef service list`                                                                               | Exit 0 — shows both tnt-api and anvil-worker                               |                                                      |
| TC-119 | `clef service show anvil-worker`                                                                  | Exit 0 — shows api + database namespaces                                   |                                                      |
| TC-120 | `clef lint`                                                                                       | Exit 0 — service identity lint checks pass                                 | `docs/guide/service-identities.md` "Drift detection" |

#### TC-121 to TC-125: Service Identity Rotation

| ID     | Command                                          | Expected                                       | Doc Reference                   |
| ------ | ------------------------------------------------ | ---------------------------------------------- | ------------------------------- |
| TC-121 | `clef service rotate tnt-api`                    | Exit 0 — new keys printed for all environments | `docs/cli/service.md` rotate    |
| TC-122 | `clef service rotate anvil-worker -e production` | Exit 0 — new key for production only           | `docs/cli/service.md` rotate -e |
| TC-123 | `clef service show tnt-api`                      | Exit 0 — new keys visible                      |                                 |
| TC-124 | `clef lint`                                      | Exit 0 — healthy after rotation                |                                 |
| TC-125 | `clef doctor`                                    | Exit 0                                         |                                 |

#### TC-126 to TC-132: Bundle Generation

| ID     | Command                                                                                        | Expected                         | Doc Reference                                             |
| ------ | ---------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------- |
| TC-126 | `clef bundle tnt-api dev -o $RUN_DIR/tnt-dev.mjs --format esm`                                 | Exit 0 — ESM module generated    | `docs/cli/bundle.md`                                      |
| TC-127 | Verify `$RUN_DIR/tnt-dev.mjs` exists and contains `getSecret`, `getAllSecrets`, `KEYS` exports | Module has documented API        | `docs/guide/service-identities.md` "Generated module API" |
| TC-128 | `clef bundle tnt-api production -o $RUN_DIR/tnt-prod.cjs --format cjs`                         | Exit 0 — CJS module generated    | `docs/cli/bundle.md` --format cjs                         |
| TC-129 | Verify `$RUN_DIR/tnt-prod.cjs` exists                                                          | File present                     |                                                           |
| TC-130 | `clef bundle anvil-worker dev -o $RUN_DIR/anvil-dev.mjs --format esm`                          | Exit 0 — multi-namespace bundle  |                                                           |
| TC-131 | Verify `$RUN_DIR/anvil-dev.mjs` exists                                                         | File present                     |                                                           |
| TC-132 | `clef bundle nonexistent-identity dev -o $RUN_DIR/bad.mjs`                                     | Exit 1 or 2 — identity not found | `docs/cli/bundle.md` exit codes                           |

#### TC-133 to TC-140: Scan

| ID     | Command                                                                  | Expected                                 | Doc Reference                      |
| ------ | ------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------- |
| TC-133 | `clef scan`                                                              | Exit 0 — no escaped secrets (clean repo) | `docs/cli/scan.md`                 |
| TC-134 | Create `$RUN_DIR/leak.js` with `const key = "sk_live_leaked_stripe_key"` | File created                             |                                    |
| TC-135 | `clef scan $RUN_DIR/leak.js`                                             | Exit 1 — pattern match for Stripe key    | `docs/cli/scan.md` "Pattern match" |
| TC-136 | `clef scan --severity high`                                              | Exit 0 or 1 depending on pattern matches | `docs/cli/scan.md` --severity      |
| TC-137 | `clef scan --json`                                                       | Valid JSON output with `matches` array   | `docs/cli/scan.md` "JSON output"   |
| TC-138 | `clef scan --staged`                                                     | Exit 0 — nothing staged                  | `docs/cli/scan.md` --staged        |
| TC-139 | Remove `$RUN_DIR/leak.js`                                                | Cleanup                                  |                                    |
| TC-140 | `clef scan`                                                              | Exit 0 — clean again                     |                                    |

#### TC-141 to TC-148: Hooks

| ID     | Command                                                 | Expected                           | Doc Reference                       |
| ------ | ------------------------------------------------------- | ---------------------------------- | ----------------------------------- |
| TC-141 | `clef hooks install`                                    | Exit 0 — pre-commit hook installed | `docs/cli/hooks.md`                 |
| TC-142 | Verify `.git/hooks/pre-commit` exists and is executable | File present with +x               |                                     |
| TC-143 | `clef doctor`                                           | Exit 0 — merge driver check passes | `docs/cli/doctor.md` "merge driver" |

#### TC-144 to TC-150: Update (Manifest Editing)

| ID     | Command                                                                  | Expected                                                                         | Doc Reference                              |
| ------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------ |
| TC-144 | Edit `clef.yaml` to add a `notifications` namespace (name + description) | YAML updated                                                                     | `docs/cli/update.md` "Add a new namespace" |
| TC-145 | `clef update`                                                            | Exit 0 — scaffolds 3 new files (notifications/{dev,staging,production}.enc.yaml) | `docs/cli/update.md`                       |
| TC-146 | Verify `secrets/notifications/dev.enc.yaml` exists                       | File present                                                                     |                                            |
| TC-147 | Verify `secrets/notifications/staging.enc.yaml` exists                   | File present                                                                     |                                            |
| TC-148 | Verify `secrets/notifications/production.enc.yaml` exists                | File present                                                                     |                                            |
| TC-149 | `clef lint`                                                              | Exit 0 — matrix complete with 12 files (4 namespaces x 3 envs)                   |                                            |
| TC-150 | `clef set notifications/dev SMTP_HOST mail.acme.local`                   | Exit 0                                                                           |                                            |

#### TC-151 to TC-155: Error Handling & Edge Cases

| ID     | Command                                           | Expected                          | Doc Reference                        |
| ------ | ------------------------------------------------- | --------------------------------- | ------------------------------------ |
| TC-151 | `clef get nonexistent/dev SOME_KEY`               | Exit 1 — invalid namespace        | Error handling                       |
| TC-152 | `clef set database/nonexistent DB_HOST value`     | Exit 1 — invalid environment      | Error handling                       |
| TC-153 | `clef diff database dev nonexistent`              | Exit 1 — invalid environment      | Error handling                       |
| TC-154 | `clef delete database/dev NONEXISTENT_KEY`        | Exit 1 — key not found            | `docs/cli/delete.md` "Key not found" |
| TC-155 | `clef bundle tnt-api nonexistent -o /tmp/bad.mjs` | Exit 1 or 2 — invalid environment | `docs/cli/bundle.md` exit codes      |

---

## Phase 3 — Execution

Execute each test case sequentially (except where tests are independent and can be
parallelised). The test cases have natural dependency chains:

1. **Parallelise Phase 1** (all 3 discovery agents)
2. **Sequential**: TC-001 → TC-010 (init chain)
3. **Parallelise by namespace**: TC-011–TC-025 (database), TC-026–TC-037 (api), TC-038–TC-045 (payments) — each namespace's sets are independent
4. **Sequential**: TC-046–TC-055 (production completion + verification)
5. **Parallelise**: TC-056–TC-065 (diff) and TC-066–TC-068 (lint) — diff and lint are read-only
6. **Sequential**: TC-069–TC-078 (delete chain)
7. **Parallelise**: TC-079–TC-088 (export/exec, read-only) and TC-089–TC-098 (import, touches api/dev only)
8. **Sequential**: TC-099–TC-105 (recipients chain)
9. **Sequential**: TC-106–TC-112 (rotation chain)
10. **Sequential**: TC-113–TC-125 (service identity chain)
11. **Parallelise**: TC-126–TC-132 (bundle, read-only) and TC-133–TC-140 (scan)
12. **Sequential**: TC-141–TC-155 (hooks, update, error handling)

### Execution Protocol

For each test case:

1. Print the test ID to stdout: `echo "--- TC-NNN: <description> ---"`
2. Run the command
3. Capture: exit code, stdout, stderr
4. Compare against expected
5. Record in the report:
   - Test ID
   - Command executed
   - Expected outcome (with doc reference)
   - Actual exit code
   - Actual stdout (first 20 lines or relevant excerpt)
   - Actual stderr (if non-empty)
   - **PASS** / **FAIL** / **SKIP** / **BLOCKED**
   - If FAIL: explanation of the discrepancy

**Interactive prompt handling**: Many commands (delete, recipients remove, protected env writes)
require interactive confirmation. Since we are running non-interactively, pipe `yes` or use
`echo y | clef ...` to auto-confirm. For protected environment writes, this tests whether the
documented confirmation prompt actually fires. If a command hangs waiting for input, mark as
BLOCKED with a note.

---

## Phase 4 — Report Generation

After all test cases complete, generate the final report at `$RUN_DIR/REPORT.md`:

```markdown
# Clef Blackbox Test Report

**Date**: <timestamp>
**Clef Version**: <version>
**Run Directory**: <path>

## Summary

| Category  | Total | Pass | Fail | Skip | Blocked |
| --------- | ----- | ---- | ---- | ---- | ------- |
| init      |       |      |      |      |         |
| crud      |       |      |      |      |         |
| ...       |       |      |      |      |         |
| **Total** |       |      |      |      |         |

## Documentation Completeness Findings

### Discrepancies Between Docs and --help

<from Agent 1C>

### Missing Documentation

<any commands or flags observed at runtime but not in docs>

### Ambiguous Documentation

<any cases where the docs were unclear and the test had to guess>

## Detailed Results

### TC-001: Doctor before init

- **Command**: `clef doctor`
- **Doc Reference**: docs/cli/doctor.md "checks" table
- **Expected**: Exit 1, manifest not found
- **Actual Exit Code**: <N>
- **Actual Output**:
```

  <stdout>
  ```
- **Status**: PASS / FAIL
- **Notes**: <if any>

... (repeat for all test cases)

## Lifecycle Narrative

A prose summary of the Acme Engineering lifecycle as experienced through the test:

1. Initialisation: what happened, any surprises
2. Secret population: bulk set across 3 namespaces, 3 environments
3. Verification: get roundtrip, diff, lint
4. Team management: adding Bob, removing Bob
5. Key rotation: rotating files, verifying value preservation
6. Service identities: creating tnt-api and anvil-worker, rotating, bundling
7. Ongoing operations: import, export, exec, scan, hooks
8. Manifest evolution: adding notifications namespace via update
9. Error handling: how clef behaves with bad inputs

## Blockers & Issues

<any issues that prevented tests from completing>
```

---

## Appendix: Documentation Source Map

All expected behaviours in this test are derived from these public sources:

| Source             | Path                               | Used For                                 |
| ------------------ | ---------------------------------- | ---------------------------------------- |
| README             | `README.md`                        | Feature overview, install, quick start   |
| Quick Start        | `docs/guide/quick-start.md`        | Init → set → get → diff → lint workflow  |
| Concepts           | `docs/guide/concepts.md`           | Two-axis model, manifest, pending values |
| Manifest Reference | `docs/guide/manifest.md`           | YAML schema, field reference             |
| Key Storage        | `docs/guide/key-storage.md`        | Key resolution order, labels             |
| Team Setup         | `docs/guide/team-setup.md`         | Recipient add/remove, DEK model          |
| Service Identities | `docs/guide/service-identities.md` | Create → bundle → rotate lifecycle       |
| Pending Values     | `docs/guide/pending-values.md`     | Random placeholder workflow              |
| Scanning           | `docs/guide/scanning.md`           | clef-ignore, suppression                 |
| CLI: init          | `docs/cli/init.md`                 | All init flags and behaviour             |
| CLI: get           | `docs/cli/get.md`                  | Raw output, exit codes                   |
| CLI: set           | `docs/cli/set.md`                  | Value argument, --random                 |
| CLI: delete        | `docs/cli/delete.md`               | Single + --all-envs                      |
| CLI: diff          | `docs/cli/diff.md`                 | Table output, JSON, flags                |
| CLI: lint          | `docs/cli/lint.md`                 | Severity, --fix, --json                  |
| CLI: rotate        | `docs/cli/rotate.md`               | --new-key, protected env                 |
| CLI: recipients    | `docs/cli/recipients.md`           | list/add/remove, -e flag                 |
| CLI: hooks         | `docs/cli/hooks.md`                | install subcommand                       |
| CLI: exec          | `docs/cli/exec.md`                 | --, --only, --prefix, --also             |
| CLI: export        | `docs/cli/export.md`               | --format, --no-export                    |
| CLI: import        | `docs/cli/import.md`               | --dry-run, formats, --keys, --prefix     |
| CLI: scan          | `docs/cli/scan.md`                 | --staged, --severity, --json             |
| CLI: doctor        | `docs/cli/doctor.md`               | Checks table, --json, --fix              |
| CLI: update        | `docs/cli/update.md`               | Scaffold missing files                   |
| CLI: service       | `docs/cli/service.md`              | create/list/show/rotate                  |
| CLI: bundle        | `docs/cli/bundle.md`               | -o, --format, exit codes                 |
