#!/usr/bin/env node
import 'dotenv/config';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import {
  DOCUMENTS,
  FULLTEXT_QUERY,
  TABLE_NAME,
  VECTOR_QUERY,
  toVectorLiteral
} from './fixture.js';
import {
  createTableSql,
  dropTableSql,
  fullTextSearchSql,
  rowCountSql,
  showCreateTableSql,
  showIndexesSql,
  upsertSql,
  vectorSearchSql
} from './sql.js';

interface TiDbConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: {
    minVersion: 'TLSv1.2';
    rejectUnauthorized: boolean;
  };
  connectTimeout: number;
  multipleStatements: false;
}

interface VersionRow extends RowDataPacket {
  version: string;
  database_name: string;
}

interface CountRow extends RowDataPacket {
  row_count: number | string;
}

interface VectorSearchRow extends RowDataPacket {
  id: number;
  title: string;
  category: string;
  distance: number;
}

interface FullTextSearchRow extends RowDataPacket {
  id: number;
  title: string;
  category: string;
  score: number;
}

interface IndexRow extends RowDataPacket {
  Key_name: string;
  Column_name: string;
  Index_type: string;
  Comment: string;
}

interface CreateTableRow extends RowDataPacket {
  'Create Table': string;
}

interface RedactedConnectionConfig {
  host: string;
  port: number;
  user: string;
  database: string;
  ssl: boolean;
}

interface DryRunRow {
  id: number;
  title: string;
  body: string;
  category: string;
  embedding: string;
}

interface DryRunPlan {
  mode: 'dry-run';
  table: typeof TABLE_NAME;
  rowCount: number;
  vectorQuery: string;
  fullTextQuery: typeof FULLTEXT_QUERY;
  sql: {
    createTableSql: string;
    upsertSql: string;
    vectorSearchSql: string;
    fullTextSearchSql: string;
  };
  sampleRows: DryRunRow[];
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const topK = Number(process.env.TOP_K ?? 3);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function boolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function connectionConfig(): TiDbConnectionConfig {
  const sslEnabled = boolEnv('TIDB_SSL', true);
  return {
    host: requiredEnv('TIDB_HOST'),
    port: Number(process.env.TIDB_PORT ?? 4000),
    user: requiredEnv('TIDB_USER'),
    password: requiredEnv('TIDB_PASSWORD'),
    database: requiredEnv('TIDB_DATABASE'),
    ssl: sslEnabled ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
    connectTimeout: 15_000,
    multipleStatements: false
  };
}

function redactConfig(config: TiDbConnectionConfig): RedactedConnectionConfig {
  return {
    host: config.host,
    port: config.port,
    user: config.user.replace(/^(.{3}).*(@.*)?$/, '$1***'),
    database: config.database,
    ssl: Boolean(config.ssl)
  };
}

function dryRunPlan(): DryRunPlan {
  const rows: DryRunRow[] = DOCUMENTS.map((doc) => ({
    ...doc,
    embedding: toVectorLiteral(doc.embedding)
  }));
  return {
    mode: 'dry-run',
    table: TABLE_NAME,
    rowCount: rows.length,
    vectorQuery: toVectorLiteral(VECTOR_QUERY),
    fullTextQuery: FULLTEXT_QUERY,
    sql: {
      createTableSql,
      upsertSql,
      vectorSearchSql,
      fullTextSearchSql
    },
    sampleRows: rows
  };
}

async function main(): Promise<void> {
  if (dryRun) {
    console.log(JSON.stringify(dryRunPlan(), null, 2));
    return;
  }

  const config = connectionConfig();
  const reset = boolEnv('TIDB_RESET', false);
  const conn = await mysql.createConnection(config);

  try {
    const [[versionRow]] = await conn.query<VersionRow[]>('SELECT VERSION() AS version, DATABASE() AS database_name;');

    if (reset) {
      await conn.execute(dropTableSql);
    }

    try {
      await conn.execute(createTableSql);
    } catch (error) {
      if (error instanceof Error) {
        error.message += '\nHint: TiDB FULLTEXT indexes are available only on supported TiDB Cloud Starter/Essential regions. Choose a supported TiDB Zero/Starter region or remove the FULLTEXT test.';
      }
      throw error;
    }

    for (const doc of DOCUMENTS) {
      await conn.execute(upsertSql, [
        doc.id,
        doc.title,
        doc.body,
        doc.category,
        toVectorLiteral(doc.embedding)
      ]);
    }

    const [[countRow]] = await conn.query<CountRow[]>(rowCountSql);
    const [vectorRows] = await conn.execute<VectorSearchRow[]>(vectorSearchSql, [toVectorLiteral(VECTOR_QUERY), topK]);
    const [fullTextRows] = await conn.execute<FullTextSearchRow[]>(fullTextSearchSql, [FULLTEXT_QUERY, FULLTEXT_QUERY, topK]);
    const [indexRows] = await conn.query<IndexRow[]>(showIndexesSql);
    const [[createRow]] = await conn.query<CreateTableRow[]>(showCreateTableSql);

    console.log(JSON.stringify({
      mode: 'live',
      connection: redactConfig(config),
      server: versionRow,
      reset,
      importedRows: DOCUMENTS.length,
      tableRowCount: Number(countRow.row_count),
      vectorSearch: {
        query: toVectorLiteral(VECTOR_QUERY),
        topK,
        rows: vectorRows
      },
      fullTextSearch: {
        query: FULLTEXT_QUERY,
        topK,
        rows: fullTextRows
      },
      indexes: indexRows.map((row) => ({
        keyName: row.Key_name,
        columnName: row.Column_name,
        indexType: row.Index_type,
        comment: row.Comment
      })),
      createTable: createRow['Create Table']
    }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error: unknown) => {
  const typedError = error as NodeJS.ErrnoException & {
    code?: string;
    errno?: number;
    sqlState?: string;
  };
  console.error(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'live',
    ok: false,
    message: typedError.message,
    code: typedError.code,
    errno: typedError.errno,
    sqlState: typedError.sqlState
  }, null, 2));
  process.exitCode = 1;
});
