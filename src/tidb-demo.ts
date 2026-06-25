import mysql, { type RowDataPacket } from 'mysql2/promise';
import {
  DOCUMENTS,
  FULLTEXT_QUERY,
  TABLE_NAME,
  VECTOR_QUERY,
  toVectorLiteral,
  type Embedding
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

export interface TiDbConnectionInput {
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
}

export interface TiDbConnectionConfig {
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

export interface RedactedConnectionConfig {
  host: string;
  port: number;
  user: string;
  database: string;
  ssl: boolean;
}

export interface VersionRow extends RowDataPacket {
  version: string;
  database_name: string;
}

export interface CountRow extends RowDataPacket {
  row_count: number | string;
}

export interface VectorSearchRow extends RowDataPacket {
  id: number;
  title: string;
  category: string;
  distance: number;
}

export interface FullTextSearchRow extends RowDataPacket {
  id: number;
  title: string;
  category: string;
  score: number;
}

export interface IndexRow extends RowDataPacket {
  Key_name: string;
  Column_name: string;
  Index_type: string;
  Comment: string;
}

export interface CreateTableRow extends RowDataPacket {
  'Create Table': string;
}

export interface DemoIndex {
  keyName: string;
  columnName: string;
  indexType: string;
  comment: string;
}

export interface DryRunRow {
  id: number;
  title: string;
  body: string;
  category: string;
  embedding: string;
}

export interface DryRunPlan {
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

export interface DemoResult {
  mode: 'live';
  connection: RedactedConnectionConfig;
  server: VersionRow;
  reset: boolean;
  importedRows: number;
  tableRowCount: number;
  vectorSearch: {
    query: string;
    topK: number;
    rows: VectorSearchRow[];
  };
  fullTextSearch: {
    query: string;
    topK: number;
    rows: FullTextSearchRow[];
  };
  indexes: DemoIndex[];
  createTable: string;
}

export interface StepResult<T> {
  ok: true;
  step: string;
  connection: RedactedConnectionConfig;
  data: T;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function boolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigError(`Missing required environment variable: ${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value == null || value === '' ? undefined : value;
}

function parsePort(value: number | string | undefined, defaultValue: number): number {
  if (value == null || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new ConfigError('Port must be an integer between 1 and 65535.');
  }
  return parsed;
}

export function connectionConfigFromEnv(): TiDbConnectionConfig {
  return connectionConfigFromInput({
    host: requiredEnv('TIDB_HOST'),
    port: process.env.TIDB_PORT ?? 4000,
    user: requiredEnv('TIDB_USER'),
    password: requiredEnv('TIDB_PASSWORD'),
    database: requiredEnv('TIDB_DATABASE'),
    ssl: boolEnv('TIDB_SSL', true)
  });
}

export function connectionDefaultsFromEnv(): Partial<TiDbConnectionInput> {
  return {
    host: optionalEnv('TIDB_HOST'),
    port: process.env.TIDB_PORT ?? 4000,
    user: optionalEnv('TIDB_USER'),
    database: optionalEnv('TIDB_DATABASE'),
    ssl: boolEnv('TIDB_SSL', true)
  };
}

export function connectionConfigFromInput(input: TiDbConnectionInput): TiDbConnectionConfig {
  const host = input.host?.trim();
  const user = input.user?.trim();
  const database = input.database?.trim();
  const password = input.password ?? '';

  if (!host) throw new ConfigError('TiDB host is required.');
  if (!user) throw new ConfigError('TiDB user is required.');
  if (!password) throw new ConfigError('TiDB password is required.');
  if (!database) throw new ConfigError('TiDB database is required.');

  const sslEnabled = input.ssl ?? true;
  return {
    host,
    port: parsePort(input.port, 4000),
    user,
    password,
    database,
    ssl: sslEnabled ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
    connectTimeout: 15_000,
    multipleStatements: false
  };
}

export function redactConfig(config: TiDbConnectionConfig): RedactedConnectionConfig {
  return {
    host: config.host,
    port: config.port,
    user: config.user.replace(/^(.{3}).*(@.*)?$/, '$1***'),
    database: config.database,
    ssl: Boolean(config.ssl)
  };
}

export function dryRunPlan(): DryRunPlan {
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

export function parseEmbeddingLiteral(value: unknown, fallback: Embedding = VECTOR_QUERY): string {
  if (value == null || value === '') return toVectorLiteral(fallback);
  if (Array.isArray(value)) return toVectorLiteral(value.map(Number));
  if (typeof value !== 'string') throw new ConfigError('Vector query must be a JSON array or comma-separated numbers.');

  const trimmed = value.trim();
  const values = trimmed.startsWith('[')
    ? JSON.parse(trimmed) as unknown
    : trimmed.split(',').map((part) => Number(part.trim()));

  if (!Array.isArray(values)) throw new ConfigError('Vector query must resolve to an array of numbers.');
  return toVectorLiteral(values.map(Number));
}

export function parseTopK(value: unknown, defaultValue = 3): number {
  if (value == null || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 50) {
    throw new ConfigError('Top K must be an integer between 1 and 50.');
  }
  return parsed;
}

export function formatStepError(error: unknown): { ok: false; message: string; code?: string; errno?: number; sqlState?: string } {
  const typedError = error as NodeJS.ErrnoException & { code?: string; errno?: number; sqlState?: string };
  const formatted: { ok: false; message: string; code?: string; errno?: number; sqlState?: string } = {
    ok: false,
    message: typedError.message ?? 'Unknown error'
  };
  if (typedError.code !== undefined) formatted.code = typedError.code;
  if (typedError.errno !== undefined) formatted.errno = typedError.errno;
  if (typedError.sqlState !== undefined) formatted.sqlState = typedError.sqlState;
  return formatted;
}

export async function healthCheck(config: TiDbConnectionConfig): Promise<StepResult<{ server: VersionRow }>> {
  const conn = await mysql.createConnection(config);
  try {
    const [[server]] = await conn.query<VersionRow[]>('SELECT VERSION() AS version, DATABASE() AS database_name;');
    return {
      ok: true,
      step: 'connect',
      connection: redactConfig(config),
      data: { server }
    };
  } finally {
    await conn.end();
  }
}

export async function initializeAndImport(config: TiDbConnectionConfig, reset = false): Promise<StepResult<{ reset: boolean; importedRows: number; tableRowCount: number }>> {
  const conn = await mysql.createConnection(config);
  try {
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
    return {
      ok: true,
      step: 'initialize',
      connection: redactConfig(config),
      data: {
        reset,
        importedRows: DOCUMENTS.length,
        tableRowCount: Number(countRow.row_count)
      }
    };
  } finally {
    await conn.end();
  }
}

export async function runVectorSearch(config: TiDbConnectionConfig, query: string, topK: number): Promise<StepResult<{ query: string; topK: number; rows: VectorSearchRow[] }>> {
  const conn = await mysql.createConnection(config);
  try {
    const [rows] = await conn.execute<VectorSearchRow[]>(vectorSearchSql, [query, topK]);
    return {
      ok: true,
      step: 'vector-search',
      connection: redactConfig(config),
      data: { query, topK, rows }
    };
  } finally {
    await conn.end();
  }
}

export async function runFullTextSearch(config: TiDbConnectionConfig, query: string, topK: number): Promise<StepResult<{ query: string; topK: number; rows: FullTextSearchRow[] }>> {
  const conn = await mysql.createConnection(config);
  try {
    const [rows] = await conn.execute<FullTextSearchRow[]>(fullTextSearchSql, [query, query, topK]);
    return {
      ok: true,
      step: 'fulltext-search',
      connection: redactConfig(config),
      data: { query, topK, rows }
    };
  } finally {
    await conn.end();
  }
}

export async function inspectTable(config: TiDbConnectionConfig): Promise<StepResult<{ indexes: DemoResult['indexes']; createTable: string }>> {
  const conn = await mysql.createConnection(config);
  try {
    const [indexRows] = await conn.query<IndexRow[]>(showIndexesSql);
    const [[createRow]] = await conn.query<CreateTableRow[]>(showCreateTableSql);
    return {
      ok: true,
      step: 'inspect',
      connection: redactConfig(config),
      data: {
        indexes: indexRows.map((row) => ({
          keyName: row.Key_name,
          columnName: row.Column_name,
          indexType: row.Index_type,
          comment: row.Comment
        })),
        createTable: createRow['Create Table']
      }
    };
  } finally {
    await conn.end();
  }
}

export async function runDemo(config: TiDbConnectionConfig, options: { reset: boolean; topK: number }): Promise<DemoResult> {
  const health = await healthCheck(config);
  const initialized = await initializeAndImport(config, options.reset);
  const vector = await runVectorSearch(config, toVectorLiteral(VECTOR_QUERY), options.topK);
  const fullText = await runFullTextSearch(config, FULLTEXT_QUERY, options.topK);
  const inspected = await inspectTable(config);

  return {
    mode: 'live',
    connection: redactConfig(config),
    server: health.data.server,
    reset: initialized.data.reset,
    importedRows: initialized.data.importedRows,
    tableRowCount: initialized.data.tableRowCount,
    vectorSearch: vector.data,
    fullTextSearch: fullText.data,
    indexes: inspected.data.indexes,
    createTable: inspected.data.createTable
  };
}
