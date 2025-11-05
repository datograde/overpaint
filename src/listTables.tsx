import "dotenv/config";
import { Client, Pool } from "pg";
import React from "react";
import { render, Box, Text } from "ink";

type TableInfo = {
  table_schema: string;
  table_name: string;
  column_count: number;
  estimated_rows: bigint;
};

type ColumnInfo = {
  column_name: string;
  data_type: string;
  min?: string | null;
  max?: string | null;
  true_count?: string | null;
  false_count?: string | null;
};

type TableView = {
  table_schema: string;
  table_name: string;
  column_count: number;
  columns: ColumnInfo[];
  estimated_rows?: bigint;
  exact_rows?: bigint | null;
};

function isNumericDataType(dt: string): boolean {
  const t = dt.toLowerCase();
  return (
    t === "numeric" ||
    t === "decimal" ||
    t === "smallint" ||
    t === "integer" ||
    t === "bigint" ||
    t === "real" ||
    t === "double precision"
  );
}
function quoteIdent(identifier: string): string {
  return '"' + identifier.replace(/"/g, '""') + '"';
}

function isBooleanDataType(dt: string): boolean {
  return dt.toLowerCase() === "boolean";
}

function formatPercentOneDecimal(n: bigint, d: bigint): string {
  if (d === 0n) return "0.0%";
  const permille = (n * 1000n + d / 2n) / d; // rounded to 0.1%
  const whole = permille / 10n;
  const tenth = permille % 10n;
  return `${whole.toString()}.${tenth.toString()}%`;
}

function booleanPercents(trueStr: string, falseStr: string): { tp: string; fp: string } {
  const t = (() => {
    try {
      return BigInt(trueStr);
    } catch {
      return 0n;
    }
  })();
  const f = (() => {
    try {
      return BigInt(falseStr);
    } catch {
      return 0n;
    }
  })();
  const d = t + f;
  return {
    tp: formatPercentOneDecimal(t, d),
    fp: formatPercentOneDecimal(f, d),
  };
}

function humanDataType(dt: string): string {
  const t = dt.toLowerCase();
  const map: Record<string, string> = {
    // timestamp/time
    "timestamp with time zone": "tstz",
    timestamptz: "tstz",
    "timestamp without time zone": "ts-ntz",
    timestamp: "ts-ntz",
    "time with time zone": "time-tz",
    timetz: "time-tz",
    "time without time zone": "time-ntz",
    time: "time-ntz",
    // strings
    "character varying": "varchar",
    varchar: "varchar",
    character: "char",
    char: "char",
    text: "text",
    // numerics
    integer: "int",
    int4: "int",
    bigint: "bigint",
    int8: "bigint",
    smallint: "smallint",
    int2: "smallint",
    numeric: "numeric",
    decimal: "decimal",
    real: "real",
    "double precision": "float8",
    float8: "float8",
    // misc
    boolean: "bool",
    bool: "bool",
    uuid: "uuid",
    jsonb: "jsonb",
    json: "json",
    bytea: "bytea",
    date: "date",
    interval: "interval",
  };
  const out = map[t] ?? dt;
  return out.length > 8 ? out.slice(0, 8) : out;
}

function isTemporalDataType(dt: string): boolean {
  const t = dt.toLowerCase();
  return (
    t === "date" ||
    t === "timestamp with time zone" ||
    t === "timestamp without time zone" ||
    t === "timestamptz" ||
    t === "time with time zone" ||
    t === "time without time zone" ||
    t === "timetz" ||
    t === "timestamp" ||
    t === "time"
  );
}

function safeParseDateLike(s: string): Date | null {
  try {
    const normalized = s.includes("T") ? s : s.replace(" ", "T");
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function parseTimeOnly(s: string): Date | null {
  const timePart = s.includes("T") ? s.split("T")[1] : s;
  const base = `1970-01-01T${timePart}`;
  const withZ = /Z|[+-]\d{2}:?\d{2}$/.test(base) ? base : `${base}Z`;
  const d = new Date(withZ);
  return isNaN(d.getTime()) ? null : d;
}

function fmtMonthYear(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function fmtHHMM(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatTemporalRange(minStr: string, maxStr: string, dt: string): string | null {
  const t = dt.toLowerCase();
  const isTimeOnly = t.startsWith("time ") || t === "time" || t === "timetz";
  if (isTimeOnly) {
    const d1 = parseTimeOnly(minStr);
    const d2 = parseTimeOnly(maxStr);
    if (!d1 || !d2) return null;
    return `${fmtHHMM(d1)}-${fmtHHMM(d2)}`;
  }
  const d1 = safeParseDateLike(minStr);
  const d2 = safeParseDateLike(maxStr);
  if (!d1 || !d2) return null;
  return `${fmtMonthYear(d1)}-${fmtMonthYear(d2)}`;
}

function getDatabaseConfigFromEnv() {
  const { DATABASE_URL } = process.env as Record<string, string | undefined>;
  if (DATABASE_URL) return { connectionString: DATABASE_URL };
  const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSL } =
    process.env as Record<string, string | undefined>;
  const config: any = {
    host: PGHOST ?? "localhost",
    port: PGPORT ? Number(PGPORT) : 5432,
    database: PGDATABASE,
    user: PGUSER,
    password: PGPASSWORD,
  };
  if (PGSSL) {
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
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const [k, v] = arg.split("=");
      if (typeof v === "undefined") flags.add(k);
      else options[k] = v;
    }
  }
  return { flags, options };
}

async function fetchNumericRanges(client: Client) {
  const numericCols = await client.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_schema, table_name, column_name
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       AND (
         data_type IN ('numeric', 'smallint', 'integer', 'bigint', 'decimal', 'real', 'double precision')
         OR data_type IN ('date', 'timestamp with time zone', 'timestamp without time zone', 'time with time zone', 'time without time zone')
       )
     ORDER BY table_schema, table_name, column_name`
  );

  const ranges = new Map<string, { min: string | null; max: string | null }>();
  
  for (const col of numericCols.rows) {
    const key = `${col.table_schema}.${col.table_name}.${col.column_name}`;
    try {
      const rangeRes = await client.query<{ min: string | null; max: string | null }>(
        `SELECT MIN(${quoteIdent(col.column_name)})::text AS min,
                MAX(${quoteIdent(col.column_name)})::text AS max
         FROM ${quoteIdent(col.table_schema)}.${quoteIdent(col.table_name)}`
      );
      ranges.set(key, {
        min: rangeRes.rows[0]?.min ?? null,
        max: rangeRes.rows[0]?.max ?? null,
      });
    } catch {
      ranges.set(key, { min: null, max: null });
    }
  }
  
  return ranges;
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
  
  const ranges = await fetchNumericRanges(client);
  const boolHist = await fetchBooleanHistograms(client);
  
  const byTable = new Map<string, ColumnInfo[]>();
  for (const r of res.rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!byTable.has(key)) byTable.set(key, []);
    
    const rangeKey = `${r.table_schema}.${r.table_name}.${r.column_name}`;
    const range = ranges.get(rangeKey);
    
    byTable.get(key)!.push({
      column_name: r.column_name,
      data_type: r.data_type,
      min: range?.min,
      max: range?.max,
      true_count: boolHist.get(`${r.table_schema}.${r.table_name}.${r.column_name}`)?.true_count ?? null,
      false_count: boolHist.get(`${r.table_schema}.${r.table_name}.${r.column_name}`)?.false_count ?? null,
    });
  }
  return byTable;
}

async function fetchBooleanHistograms(client: Client) {
  const booleanCols = await client.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_schema, table_name, column_name
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       AND data_type = 'boolean'
     ORDER BY table_schema, table_name, column_name`
  );

  const hist = new Map<
    string,
    { true_count: string | null; false_count: string | null }
  >();

  for (const col of booleanCols.rows) {
    const key = `${col.table_schema}.${col.table_name}.${col.column_name}`;
    try {
      const sql = `SELECT 
          COUNT(*) FILTER (WHERE ${quoteIdent(col.column_name)} IS TRUE)::bigint AS t,
          COUNT(*) FILTER (WHERE ${quoteIdent(col.column_name)} IS FALSE)::bigint AS f
        FROM ${quoteIdent(col.table_schema)}.${quoteIdent(col.table_name)}`;
      const res = await client.query<{ t: string; f: string }>(sql);
      hist.set(key, {
        true_count: res.rows[0]?.t ?? null,
        false_count: res.rows[0]?.f ?? null,
      });
    } catch {
      hist.set(key, { true_count: null, false_count: null });
    }
  }
  return hist;
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
  const countLabelFor = (v: TableView) =>
    mode === "estimated"
      ? `~${v.estimated_rows?.toString() ?? "0"}`
      : v.exact_rows === null
      ? "error"
      : v.exact_rows?.toString() ?? "0";

  const App: React.FC = () => (
    <Box flexDirection="column" paddingBottom={1}>
      <Text color="cyan" bold>
        {mode === "estimated"
          ? "Tables (schema.table) — ~rows (estimated), columns:"
          : "Tables (schema.table) — rows (exact), columns:"}
      </Text>
      {views.map((v) => {
        const maxName = v.columns.length
          ? Math.max(...v.columns.map((co) => co.column_name.length))
          : 0;
        return (
          <Box
            key={`${v.table_schema}.${v.table_name}`}
            flexDirection="column"
            marginTop={1}
            padding={1}
            borderStyle="round"
            borderColor="gray"
          >
            <Text>
              <Text bold color="yellow">
                {v.table_schema}.{v.table_name}
              </Text>
              <Text> — </Text>
              <Text
                color={
                  mode === "estimated"
                    ? "magenta"
                    : v.exact_rows === null
                    ? "red"
                    : "green"
                }
              >
                {countLabelFor(v)} rows
              </Text>
              <Text>, </Text>
              <Text color="blue">{v.column_count} cols</Text>
            </Text>
            {v.columns.length > 0 && (() => {
              const rows = v.columns.map((c) => {
                const typeLabel = humanDataType(c.data_type);
                let range = "";
                if (isNumericDataType(c.data_type) && c.min !== null && c.max !== null) {
                  range = `${c.min}-${c.max}`;
                } else if (isTemporalDataType(c.data_type) && c.min !== null && c.max !== null) {
                  const fr = formatTemporalRange(c.min!, c.max!, c.data_type);
                  range = fr ?? "";
                }
                let values = "";
                if (isBooleanDataType(c.data_type) && c.true_count !== null && c.false_count !== null) {
                  const { tp, fp } = booleanPercents(c.true_count!, c.false_count!);
                  values = `Yes ${c.true_count} (${tp}) | No ${c.false_count} (${fp})`;
                }
                return { name: c.column_name, typeLabel, range, values };
              });
              const nameW = Math.max(...rows.map(r => r.name.length));
              const typeW = Math.max(...rows.map(r => r.typeLabel.length));
              const rangeW = Math.max(5, ...rows.map(r => r.range.length));
              return (
                <Box flexDirection="column" marginTop={1}>
                  <Text>
                    <Text color="gray" bold>{"name".padEnd(nameW, " ")}</Text>
                    <Text>  </Text>
                    <Text color="gray" bold>{"type".padEnd(typeW, " ")}</Text>
                    <Text>  </Text>
                    <Text color="gray" bold>{"range".padEnd(rangeW, " ")}</Text>
                    <Text>  </Text>
                    <Text color="gray" bold>values</Text>
                  </Text>
                  {rows.map((r) => (
                    <Text key={r.name}>
                      <Text color="green">{r.name.padEnd(nameW, " ")}</Text>
                      <Text>  </Text>
                      <Text color="gray">{r.typeLabel.padEnd(typeW, " ")}</Text>
                      <Text>  </Text>
                      {r.range ? (
                        <Text color="yellow">{r.range.padEnd(rangeW, " ")}</Text>
                      ) : (
                        <Text>{"".padEnd(rangeW, " ")}</Text>
                      )}
                      <Text>  </Text>
                      {r.values ? (
                        <Text color="yellow">{r.values}</Text>
                      ) : null}
                    </Text>
                  ))}
                </Box>
              );
            })()}
          </Box>
        );
      })}
    </Box>
  );

  const { waitUntilExit } = render(<App />);
  return waitUntilExit();
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
