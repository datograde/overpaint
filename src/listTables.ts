import "dotenv/config";
import { Client, Pool } from "pg";

type TableInfo = {
  table_schema: string;
  table_name: string;
  column_count: number;
  estimated_rows: bigint;
};

type ColumnInfo = {
  column_name: string;
  data_type: string;
};

type TableView = {
  table_schema: string;
  table_name: string;
  column_count: number;
  columns: ColumnInfo[];
  estimated_rows?: bigint;
  exact_rows?: bigint | null;
};

function quoteIdent(identifier: string): string {
  return '"' + identifier.replace(/"/g, '""') + '"';
}

function getDatabaseConfigFromEnv() {
  const { DATABASE_URL } = process.env;
  if (DATABASE_URL) {
    return { connectionString: DATABASE_URL };
  }

  const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSL } = process.env;

  const config: any = {
    host: PGHOST ?? "localhost",
    port: PGPORT ? Number(PGPORT) : 5432,
    database: PGDATABASE,
    user: PGUSER,
    password: PGPASSWORD,
  };

  if (PGSSL) {
    // Allow simple toggles like '1', 'true'
    const enabled = PGSSL.toLowerCase() === "true" || PGSSL === "1";
    if (enabled) config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const flags = new Set<string>();
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [k, v] = arg.split("=");
      if (typeof v === "undefined") flags.add(k);
      else options[k] = v;
    }
  }
  return { flags, options };
}

async function fetchColumnsByTable(client: Client) {
  const res = await client.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
  }>(
    `SELECT table_schema, table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name, ordinal_position`
  );
  const byTable = new Map<string, ColumnInfo[]>();
  for (const r of res.rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!byTable.has(key)) byTable.set(key, []);
    byTable
      .get(key)!
      .push({ column_name: r.column_name, data_type: r.data_type });
  }
  return byTable;
}

function printColumns(columns: ColumnInfo[] | undefined) {
  if (!columns || columns.length === 0) return;
  const maxName = Math.max(...columns.map((c) => c.column_name.length));
  console.log("  columns:");
  for (const c of columns) {
    const namePadded = c.column_name.padEnd(maxName, " ");
    console.log(`  ${namePadded}  ${c.data_type}`);
  }
}

async function fetchEstimatedTables(client: Client) {
  const res = await client.query<TableInfo>(
    `WITH cols AS (
       SELECT table_schema, table_name, COUNT(*)::int AS column_count
       FROM information_schema.columns
       GROUP BY table_schema, table_name
     )
     SELECT n.nspname AS table_schema,
            c.relname AS table_name,
            COALESCE(cols.column_count, 0) AS column_count,
            GREATEST(c.reltuples::bigint, 0) AS estimated_rows
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN cols ON cols.table_schema = n.nspname AND cols.table_name = c.relname
     WHERE c.relkind = 'r'
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     ORDER BY n.nspname, c.relname`
  );
  return res.rows;
}

function buildEstimatedView(
  estimated: TableInfo[],
  columnsByTable: Map<string, ColumnInfo[]>
): TableView[] {
  return estimated.map((t) => ({
    table_schema: t.table_schema,
    table_name: t.table_name,
    column_count: t.column_count,
    columns: columnsByTable.get(`${t.table_schema}.${t.table_name}`) ?? [],
    estimated_rows: t.estimated_rows,
  }));
}

function renderTables(views: TableView[], mode: "estimated" | "exact") {
  const header =
    mode === "estimated"
      ? "Tables (schema.table) — ~rows (estimated), columns:"
      : "Tables (schema.table) — rows (exact), columns:";
  console.log(header);
  for (const v of views) {
    const countLabel =
      mode === "estimated"
        ? `~${v.estimated_rows?.toString() ?? "0"}`
        : v.exact_rows === null
        ? "error"
        : v.exact_rows?.toString() ?? "0";
    console.log(
      `\n- ${v.table_schema}.${v.table_name} — ${countLabel} rows, ${v.column_count} cols\n`
    );
    printColumns(v.columns);
  }
}

async function buildExactView(
  estimated: TableInfo[],
  columnsByTable: Map<string, ColumnInfo[]>
): Promise<TableView[]> {
  const pool = new Pool(getDatabaseConfigFromEnv() as any);
  try {
    const views: TableView[] = [];
    for (const t of estimated) {
      let exact: bigint | null = null;
      try {
        const countSql = `SELECT COUNT(*)::bigint AS count FROM ${quoteIdent(
          t.table_schema
        )}.${quoteIdent(t.table_name)}`;
        const r = await pool.query<{ count: string }>(countSql);
        exact = BigInt(r.rows[0].count);
      } catch {
        exact = null;
      }
      views.push({
        table_schema: t.table_schema,
        table_name: t.table_name,
        column_count: t.column_count,
        columns: columnsByTable.get(`${t.table_schema}.${t.table_name}`) ?? [],
        exact_rows: exact,
      });
    }
    return views;
  } finally {
    await pool.end().catch(() => {});
  }
}

// All rendering goes through renderTables

async function listTables() {
  const client = new Client(getDatabaseConfigFromEnv());
  await client.connect();
  try {
    const estimated = await fetchEstimatedTables(client);
    const columnsByTable = await fetchColumnsByTable(client);

    if (estimated.length === 0) {
      console.log("No tables found.");
      return;
    }

    const { flags } = parseArgs();
    const wantExact = flags.has("--exact");

    if (!wantExact) {
      const views = buildEstimatedView(estimated, columnsByTable);
      return renderTables(views, "estimated");
    }
    const views = await buildExactView(estimated, columnsByTable);
    return renderTables(views, "exact");
  } finally {
    await client.end();
  }
}

listTables().catch((err) => {
  console.error("Failed to list tables:", err);
  process.exitCode = 1;
});
