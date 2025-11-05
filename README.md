# Overpaint: Data quality monitor for PostgresSQL

A tiny TypeScript utility that connects to a PostgreSQL database and prints all user tables (schema-qualified) using `information_schema.tables`.

- Minimal setup, zero build step (runs via `tsx`)
- Supports `DATABASE_URL` or individual `PG*` environment variables
- Optional SSL toggle (for managed DBs)
- Efficient by default: gets row counts from PostgreSQL estimates in a single query; switch to exact counts with a flag

# DEMO

```bash
$ npm run list:tables
Tables (schema.table) — ~rows (estimated), columns:

- public.accounts — ~120000 rows, 6 cols

  columns:
  id          integer
  email       character varying
  created_at  timestamp with time zone
  status      text
  plan        text
  balance     numeric

- public.transactions — ~987654 rows, 8 cols

  columns:
  id             bigint
  account_id     integer
  amount         numeric
  currency       text
  category       text
  created_at     timestamp with time zone
  description    text
  is_disputed    boolean

- auth.users — ~5231 rows, 5 cols

  columns:
  id          uuid
  email       character varying
  role        text
  created_at  timestamp with time zone
  disabled    boolean
```

# Features

- Estimated row counts in a single, fast catalog query
- Exact counts via `--exact` with controlled concurrency and `statement_timeout`
- Per-table column details (name and data type)
- Safe identifier quoting for schema/table names
- `.env` support and `PG*` env variables, plus `DATABASE_URL`
- Optional SSL via `PGSSL=true`
- ESM-first, runs via `tsx` (no build step)

## Requirements

- Node.js 18+ (ESM)
- Access to a PostgreSQL instance

## Installation

This repository already contains everything needed. Just install dependencies:

```bash
npm install
```

## Configuration

You can configure the connection using one of the following methods.

### Option A — DATABASE_URL

Set a single `DATABASE_URL` env var:

```bash
export DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
```

### Option B — Individual PG variables

Set the standard `PG*` variables:

```bash
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=your_db
export PGUSER=your_user
export PGPASSWORD=your_password
# Optional SSL:
# export PGSSL=true
```

### Option C — .env file

Create a `.env` file in the project root:

```bash
# EITHER a single URL
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME

# OR individual vars
# PGHOST=localhost
# PGPORT=5432
# PGDATABASE=your_db
# PGUSER=your_user
# PGPASSWORD=your_password
# PGSSL=false
```

`.env` is loaded automatically via `dotenv`.

## Usage

List tables with estimated row counts (fast):

```bash
npm run list:tables
```

Get exact row counts (slower, controlled):

```bash
npm run list:tables -- --exact [--concurrency=3] [--statement-timeout-ms=10000]
```

Example output:

```bash
Tables:
- public.accounts
- public.transactions
- auth.users
```

If no tables are found, you’ll see:

```bash
No tables found.
```

## Troubleshooting

- ECONNREFUSED / could not connect

  - Ensure the DB is reachable from your machine (host, port, firewall/VPN)
  - Verify credentials and that the user has connect privileges
  - If connecting to a managed DB that requires SSL, set `PGSSL=true`

- TLS/SSL errors

  - Try `PGSSL=true` (the tool sets `ssl: { rejectUnauthorized: false }`)
  - For stricter security, configure a proper SSL context instead of the simple toggle

- Missing types for Node or pg
  - Run: `npm i -D @types/node @types/pg`

## Scripts

- `npm run list:tables` — Runs the TypeScript script via `tsx`

## How it works

By default, the tool:

- Aggregates column counts from `information_schema.columns`
- Reads estimated row counts from `pg_class.reltuples` joined with `pg_namespace` (single, fast catalog query)

With `--exact`, it:

- Applies a `statement_timeout` (default 10s)
- Runs `COUNT(*)` per table with a small concurrency pool (default 3)
- Safely quotes schema/table identifiers

Source:

- `src/listTables.ts`

## License

MIT
