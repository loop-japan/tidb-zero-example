#!/usr/bin/env node
import 'dotenv/config';
import mysql from 'mysql2/promise';
import {
  DOCUMENTS,
  FULLTEXT_QUERY,
  TABLE_NAME,
  VECTOR_QUERY,
  toVectorLiteral
} from './fixture.mjs';
import {
  createTableSql,
  dropTableSql,
  fullTextSearchSql,
  rowCountSql,
  showCreateTableSql,
  showIndexesSql,
  upsertSql,
  vectorSearchSql
} from './sql.mjs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const topK = Number(process.env.TOP_K ?? 3);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function boolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function connectionConfig() {
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

function redactConfig(config) {
  return {
    host: config.host,
    port: config.port,
    user: config.user.replace(/^(.{3}).*(@.*)?$/, '$1***'),
    database: config.database,
    ssl: Boolean(config.ssl)
  };
}

function dryRunPlan() {
  const rows = DOCUMENTS.map((doc) => ({
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

async function main() {
  if (dryRun) {
    console.log(JSON.stringify(dryRunPlan(), null, 2));
    return;
  }

  const config = connectionConfig();
  const reset = boolEnv('TIDB_RESET', false);
  const conn = await mysql.createConnection(config);

  try {
    const [[versionRow]] = await conn.query('SELECT VERSION() AS version, DATABASE() AS database_name;');

    if (reset) {
      await conn.execute(dropTableSql);
    }

    try {
      await conn.execute(createTableSql);
    } catch (error) {
      error.message += '\nHint: TiDB FULLTEXT indexes are available only on supported TiDB Cloud Starter/Essential regions. Choose a supported TiDB Zero/Starter region or remove the FULLTEXT test.';
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

    const [[countRow]] = await conn.query(rowCountSql);
    const [vectorRows] = await conn.execute(vectorSearchSql, [toVectorLiteral(VECTOR_QUERY), topK]);
    const [fullTextRows] = await conn.execute(fullTextSearchSql, [FULLTEXT_QUERY, FULLTEXT_QUERY, topK]);
    const [indexRows] = await conn.query(showIndexesSql);
    const [[createRow]] = await conn.query(showCreateTableSql);

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

main().catch((error) => {
  console.error(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'live',
    ok: false,
    message: error.message,
    code: error.code,
    errno: error.errno,
    sqlState: error.sqlState
  }, null, 2));
  process.exitCode = 1;
});
