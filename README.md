# Overpaint: Data quality monitor for PostgresSQL

A tiny TypeScript utility that connects to a PostgreSQL database and prints all user tables (schema-qualified) with a readable column summary.

- Minimal setup, zero build step (runs via `tsx`)
- Supports `DATABASE_URL` or individual `PG*` environment variables
- Optional SSL toggle (for managed DBs)
- Efficient by default: gets row counts from PostgreSQL estimates in a single query; switch to exact counts with a flag

## Demo

```bash
$ npm run list:tables
Tables (schema.table) — ~rows (estimated), columns:

public.orders — ~42000 rows, 8 cols

name          type     range              values
id            int      1-100000
created_at    ts-ntz   Jan 2020-Oct 2025
updated_at    ts-ntz   Jan 2020-Oct 2025
customer_id   int      1-50000
total_amount  numeric  5-10499
delivered     bool                        Yes 28000 (66.7%) | No 14000 (33.3%)
notes         text
metadata      jsonb

analytics.events — ~5300000 rows, 6 cols

name         type     range              values
event_date   date     Jan 2020-Oct 2025
occurred_at  ts-ntz   Mar 2024-Oct 2025
duration     time     00:00-23:59
user_id      int      1-50000
event_type   varchar
props        jsonb

auth.users — ~12000 rows, 5 cols

name        type     range              values
id          uuid
email       varchar
created_at  ts-ntz   Jan 2022-Oct 2025
active      bool                        Yes 9600 (80.0%) | No 2400 (20.0%)
```

## Features

- Estimated row counts from catalog metadata (fast, single query)
- Exact counts via `--exact` when needed
- 4-column column view: name, type, range, values
- Humanized types (≤8 chars) like `ts-ntz`, `varchar`, `float8`
- Ranges for numeric and temporal types (e.g., `Oct 2020-Jan 2024`, `08:00-17:30`)
- Boolean histograms with counts and percentages: `Yes N (x%) | No M (y%)`
- Safe identifier quoting for schema/table names
- `.env` support and `PG*` env variables, plus `DATABASE_URL`
- Optional SSL via `PGSSL=true`
- ESM-first, runs via `tsx` (no build step)

## Requirements

- Node.js 18+ (ESM)
- Access to a PostgreSQL instance

## Installation

This repository already contains everything needed. Copy each step and run in order:

Step 1 — Get the code
```bash
git clone https://github.com/datograde/overpaint.git
cd overpaint
npm install
```

Step 2 — Configure database credentials (pick ONE)
```bash
# Single URL (recommended)
export DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/DBNAME"

# OR individual vars
# export PGHOST=localhost
# export PGPORT=5432
# export PGDATABASE=your_db
# export PGUSER=your_user
# export PGPASSWORD=your_password
# Optional SSL:
# export PGSSL=true
```

Step 3 — Run the tool
```bash
# Estimated row counts (fast)
npm run list:tables

# Exact row counts (slower)
# npm run list:tables -- --exact
```

## Configuration

You can configure the connection using one of the following methods.

## Option A — DATABASE_URL

Set a single `DATABASE_URL` env var:

```bash
export DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
```

## Option B — Individual PG variables

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

## Option C — .env file

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
Tables (schema.table) — ~rows (estimated), columns:
public.example_table — ~1234 rows, 3 cols

name   type   range     values
id     int    1-1234
active bool             Yes 900 (72.9%) | No 334 (27.1%)
created ts-ntz Jan 2020-Oct 2025
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
- Computes MIN/MAX for numeric and temporal columns to show ranges
- Counts boolean values using `COUNT(*) FILTER (WHERE col IS TRUE/FALSE)`

With `--exact`, it:

- Runs `COUNT(*)` per table (may be slow on very large tables)
- Safely quotes schema/table identifiers

Source:

- `src/listTables.tsx`

## License

MIT
