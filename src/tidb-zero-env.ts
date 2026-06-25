import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_API_URL = 'https://zero.tidbapi.com/v1beta1/instances';
const DEFAULT_TAG = 'tidb-zero-example';
const DEFAULT_RESPONSE_PATH = 'tidb-zero.json';
const DEFAULT_ENV_PATH = '.env';
const DEFAULT_DATABASE = 'test';

export type TidbEnvConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  reset: boolean;
};

export type ParseTidbZeroOptions = {
  database?: string;
  ssl?: boolean;
  reset?: boolean;
};

export type CliOptions = ParseTidbZeroOptions & {
  create: boolean;
  from?: string;
  responsePath: string;
  envPath: string;
  tag: string;
  apiUrl: string;
  apiKeyEnv: string;
  force: boolean;
  dryRun: boolean;
  help: boolean;
};

type UnknownRecord = Record<string, unknown>;

type CreateInstancePayload = {
  tag: string;
};

export class TidbZeroEnvError extends Error {
  override name = 'TidbZeroEnvError';
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown, key: string): UnknownRecord | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return isRecord(child) ? child : undefined;
}

function stringAt(record: UnknownRecord | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function numberAt(record: UnknownRecord | undefined, keys: string[]): number | undefined {
  const raw = stringAt(record, keys);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new TidbZeroEnvError(`Invalid TiDB port: ${raw}`);
  }
  return value;
}

function parseBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on', 'required', 'require'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', 'disabled', 'disable'].includes(normalized)) return false;
  }
  throw new TidbZeroEnvError(`Invalid boolean for ${fieldName}: ${String(value)}`);
}

function booleanAt(record: UnknownRecord | undefined, keys: string[], fieldName: string): boolean | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const parsed = parseBoolean(record[key], fieldName);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function connectionStringFrom(root: UnknownRecord, instance: UnknownRecord | undefined, connection: UnknownRecord | undefined): string | undefined {
  return (
    stringAt(instance, ['connectionString', 'connection_string', 'dsn', 'url']) ??
    stringAt(connection, ['connectionString', 'connection_string', 'dsn', 'url']) ??
    stringAt(root, ['connectionString', 'connection_string', 'dsn', 'url'])
  );
}

function parseConnectionString(connectionString: string | undefined): Partial<TidbEnvConfig> {
  if (!connectionString) return {};

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch (error) {
    throw new TidbZeroEnvError(`Invalid TiDB connectionString URL: ${error instanceof Error ? error.message : String(error)}`);
  }

  const protocol = url.protocol.replace(/:$/, '').toLowerCase();
  if (!['mysql', 'mysql2'].includes(protocol)) {
    throw new TidbZeroEnvError(`Unsupported connectionString protocol: ${url.protocol}`);
  }

  const tlsParam = url.searchParams.get('ssl') ?? url.searchParams.get('tls');
  return {
    host: url.hostname || undefined,
    port: url.port ? Number(url.port) : undefined,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database: url.pathname && url.pathname !== '/' ? decodeURIComponent(url.pathname.slice(1)) : undefined,
    ssl: tlsParam === null ? undefined : parseBoolean(tlsParam, 'ssl'),
  };
}

function requireValue(value: string | undefined, fieldName: string): string {
  if (value && value.trim() !== '') return value;
  throw new TidbZeroEnvError(`TiDB Zero response is missing connection ${fieldName}`);
}

export function parseTidbZeroResponse(raw: unknown, options: ParseTidbZeroOptions = {}): TidbEnvConfig {
  if (!isRecord(raw)) {
    throw new TidbZeroEnvError('TiDB Zero response must be a JSON object');
  }

  const instance = recordAt(raw, 'instance') ?? raw;
  const connection = recordAt(instance, 'connection') ?? recordAt(raw, 'connection');
  const fromConnectionString = parseConnectionString(connectionStringFrom(raw, instance, connection));

  const host = stringAt(connection, ['host', 'hostname', 'endpoint']) ?? stringAt(instance, ['host', 'hostname', 'endpoint']) ?? fromConnectionString.host;
  const port = numberAt(connection, ['port']) ?? numberAt(instance, ['port']) ?? fromConnectionString.port ?? 4000;
  const user = stringAt(connection, ['username', 'user']) ?? stringAt(instance, ['username', 'user']) ?? fromConnectionString.user;
  const password = stringAt(connection, ['password']) ?? stringAt(instance, ['password']) ?? fromConnectionString.password;
  const database =
    options.database ??
    stringAt(connection, ['database', 'db', 'databaseName']) ??
    stringAt(instance, ['database', 'db', 'databaseName']) ??
    fromConnectionString.database ??
    DEFAULT_DATABASE;
  const ssl = options.ssl ?? booleanAt(connection, ['ssl', 'tls'], 'ssl') ?? booleanAt(instance, ['ssl', 'tls'], 'ssl') ?? fromConnectionString.ssl ?? true;

  return {
    host: requireValue(host, 'host'),
    port,
    user: requireValue(user, 'username'),
    password: requireValue(password, 'password'),
    database,
    ssl,
    reset: options.reset ?? false,
  };
}

function quoteEnvValue(value: string): string {
  if (/^[A-Za-z0-9_.:/@+-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

export function renderEnv(config: TidbEnvConfig): string {
  return [
    '# Generated from TiDB Zero connection info. Do not commit this file.',
    `TIDB_HOST=${quoteEnvValue(config.host)}`,
    `TIDB_PORT=${config.port}`,
    `TIDB_USER=${quoteEnvValue(config.user)}`,
    `TIDB_PASSWORD=${quoteEnvValue(config.password)}`,
    `TIDB_DATABASE=${quoteEnvValue(config.database)}`,
    `TIDB_SSL=${config.ssl ? 'true' : 'false'}`,
    `TIDB_RESET=${config.reset ? 'true' : 'false'}`,
    '',
  ].join('\n');
}

export function redactedEnvPreview(config: TidbEnvConfig): string {
  return renderEnv({ ...config, password: '<redacted>' });
}

function usage(): string {
  return `Usage:
  pnpm tidb-zero:env -- --create [--tag tidb-zero-example] [--force]
  pnpm tidb-zero:env -- --from tidb-zero.json [--force]

Creates a .env file for this repository from TiDB Zero connection info.

Options:
  --create                 POST to the TiDB Zero v1beta1 instances API.
  --from <path>            Read an existing TiDB Zero JSON response instead of calling the API.
  --response <path>        Where to save the API response when --create is used (default: tidb-zero.json).
  --env <path>             .env output path (default: .env).
  --tag <tag>              Tag sent to TiDB Zero when creating an instance (default: tidb-zero-example).
  --database <name>        Database name for TIDB_DATABASE if not provided by the response (default: test).
  --ssl <true|false>       Override TIDB_SSL (default: true when not provided by the response).
  --reset <true|false>     Set TIDB_RESET in the generated .env (default: false).
  --api-url <url>          Override API endpoint (default: ${DEFAULT_API_URL}).
  --api-key-env <name>     Environment variable containing a Bearer token (default: TIDB_ZERO_API_KEY).
  --force                  Overwrite existing output files.
  --dry-run                Validate and print a redacted .env preview without writing files.
  --help                   Show this help.
`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    create: false,
    responsePath: DEFAULT_RESPONSE_PATH,
    envPath: DEFAULT_ENV_PATH,
    tag: DEFAULT_TAG,
    apiUrl: DEFAULT_API_URL,
    apiKeyEnv: 'TIDB_ZERO_API_KEY',
    force: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const readValue = (): string => {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new TidbZeroEnvError(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    switch (arg) {
      case '--':
        break;
      case '--create':
        options.create = true;
        break;
      case '--from':
        options.from = readValue();
        break;
      case '--response':
        options.responsePath = readValue();
        break;
      case '--env':
        options.envPath = readValue();
        break;
      case '--tag':
        options.tag = readValue();
        break;
      case '--database':
        options.database = readValue();
        break;
      case '--ssl':
        options.ssl = parseBoolean(readValue(), 'ssl');
        break;
      case '--reset':
        options.reset = parseBoolean(readValue(), 'reset');
        break;
      case '--api-url':
        options.apiUrl = readValue();
        break;
      case '--api-key-env':
        options.apiKeyEnv = readValue();
        break;
      case '--force':
        options.force = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new TidbZeroEnvError(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }

  if (options.create && options.from) {
    throw new TidbZeroEnvError('Use either --create or --from, not both.');
  }
  if (!options.help && !options.create && !options.from) {
    throw new TidbZeroEnvError(`Choose --create to call TiDB Zero or --from <path> to use a saved response.\n\n${usage()}`);
  }

  return options;
}

async function ensureParentDirectory(path: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
}

async function assertWritableTarget(path: string, force: boolean): Promise<void> {
  if (force) return;
  try {
    const info = await stat(path);
    if (info.isFile()) throw new TidbZeroEnvError(`${path} already exists. Re-run with --force to overwrite.`);
    throw new TidbZeroEnvError(`${path} exists and is not a regular file.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  const content = await readFile(path, 'utf8');
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new TidbZeroEnvError(`Could not parse ${path} as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createTidbZeroInstance(options: CliOptions): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = process.env[options.apiKeyEnv];
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const payload: CreateInstancePayload = { tag: options.tag };
  const response = await fetch(options.apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new TidbZeroEnvError(`TiDB Zero API request failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new TidbZeroEnvError(`TiDB Zero API did not return JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const response = options.create ? await createTidbZeroInstance(options) : await readJsonFile(options.from ?? DEFAULT_RESPONSE_PATH);
  const envConfig = parseTidbZeroResponse(response, options);

  if (options.dryRun) {
    process.stdout.write(redactedEnvPreview(envConfig));
    return;
  }

  await assertWritableTarget(options.envPath, options.force);
  if (options.create) await assertWritableTarget(options.responsePath, options.force);

  if (options.create) {
    await ensureParentDirectory(options.responsePath);
    await writeFile(options.responsePath, `${JSON.stringify(response, null, 2)}\n`, { mode: 0o600 });
  }

  await ensureParentDirectory(options.envPath);
  await writeFile(options.envPath, renderEnv(envConfig), { mode: 0o600 });

  const savedResponseMessage = options.create ? ` Saved API response to ${options.responsePath}; keep it private.` : '';
  process.stdout.write(`Wrote ${options.envPath} for ${envConfig.host}:${envConfig.port} as ${envConfig.user} (password redacted).${savedResponseMessage}\n`);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

