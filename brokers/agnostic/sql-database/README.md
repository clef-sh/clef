# sql-database

## Description

Create ephemeral database users with short-lived credentials using customizable SQL templates. One broker covers every SQL database — PostgreSQL, MySQL, MSSQL, Oracle. You write the CREATE and DROP statements; the broker handles username generation, password rotation, and cleanup.

This is a Tier 2 broker: the broker creates a new database user on each rotation and revokes the previous one automatically.

## Prerequisites

- A database admin user with permission to create and drop roles
- Network access from the broker to the database
- The appropriate Knex driver installed (`pg`, `mysql2`, `mssql`, `oracledb`)

## Configuration

| Input               | Required | Secret | Default     | Description                                      |
| ------------------- | -------- | ------ | ----------- | ------------------------------------------------ |
| `DB_CLIENT`         | No       | No     | `pg`        | Knex client: `pg`, `mysql2`, `mssql`, `oracledb` |
| `DB_HOST`           | Yes      | No     | —           | Database hostname                                |
| `DB_PORT`           | No       | No     | `5432`      | Database port                                    |
| `DB_NAME`           | Yes      | No     | —           | Database name                                    |
| `DB_ADMIN_USER`     | Yes      | Yes    | —           | Admin user for creating/dropping roles           |
| `DB_ADMIN_PASSWORD` | Yes      | Yes    | —           | Admin password                                   |
| `TTL`               | No       | No     | `3600`      | Credential TTL in seconds                        |
| `CREATE_STATEMENT`  | No       | No     | (see below) | Handlebars SQL template for user creation        |
| `REVOKE_STATEMENT`  | No       | No     | (see below) | Handlebars SQL template for user revocation      |

### SQL Template Variables

| Variable         | Available In   | Description                                     |
| ---------------- | -------------- | ----------------------------------------------- |
| `{{username}}`   | CREATE, REVOKE | Generated username (e.g., `clef_1711101600000`) |
| `{{password}}`   | CREATE         | Generated 24-character password                 |
| `{{expiration}}` | CREATE         | ISO-8601 expiry timestamp                       |

## Deploy

```bash
clef install sql-database

# Store admin credentials in a Clef namespace
clef set broker-sql/production DB_ADMIN_USER "clef_admin"
clef set broker-sql/production DB_ADMIN_PASSWORD "admin-password"

# Set non-secret config as env vars
export CLEF_BROKER_HANDLER_DB_HOST="mydb.example.com"
export CLEF_BROKER_HANDLER_DB_NAME="myapp"

# Deploy as Lambda (see shared deployment templates)
```

### PostgreSQL (default)

The default templates work with PostgreSQL:

```sql
-- CREATE_STATEMENT (default)
CREATE ROLE "{{username}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{{username}}";

-- REVOKE_STATEMENT (default)
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "{{username}}";
DROP ROLE IF EXISTS "{{username}}";
```

### MySQL

```sql
-- CREATE_STATEMENT
CREATE USER '{{username}}'@'%' IDENTIFIED BY '{{password}}';
GRANT SELECT ON mydb.* TO '{{username}}'@'%';

-- REVOKE_STATEMENT
DROP USER IF EXISTS '{{username}}'@'%';
```

### MSSQL

```sql
-- CREATE_STATEMENT
CREATE LOGIN [{{username}}] WITH PASSWORD = '{{password}}';
CREATE USER [{{username}}] FOR LOGIN [{{username}}];
ALTER ROLE db_datareader ADD MEMBER [{{username}}];

-- REVOKE_STATEMENT
DROP USER IF EXISTS [{{username}}];
DROP LOGIN [{{username}}];
```

## How It Works

1. The broker generates a unique username (`clef_<timestamp>`) and a random 24-character password
2. It executes the `CREATE_STATEMENT` template against the database using the admin credentials
3. It packs `DB_USER` and `DB_PASSWORD` into a Clef artifact envelope with KMS envelope encryption
4. The agent polls the broker, unwraps via KMS, and serves credentials to your app
5. On the next rotation (when the cache expires), the broker:
   - Executes the `REVOKE_STATEMENT` to drop the previous user
   - Creates a new user with fresh credentials
   - The agent swaps atomically — your app sees the new credentials on next read
