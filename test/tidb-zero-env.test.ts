import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseTidbZeroResponse, redactedEnvPreview, renderEnv, runCli, TidbZeroEnvError } from '../src/tidb-zero-env.js';

const sampleResponse = {
  instance: {
    id: 'zero-123',
    connection: {
      host: 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
      port: 4000,
      username: 'abc.root',
      password: 'secret#value with spaces',
    },
    connectionString: 'mysql://abc.root:secret%23value%20with%20spaces@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/test?ssl=true',
    claimInfo: { claimUrl: 'https://tidbcloud.com/tidbs/claim/example' },
    expiresAt: '2026-07-25T00:00:00Z',
  },
};

test('parses TiDB Zero v1beta1 response into repository env keys', () => {
  const config = parseTidbZeroResponse(sampleResponse);
  assert.deepEqual(config, {
    host: 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: 'abc.root',
    password: 'secret#value with spaces',
    database: 'test',
    ssl: true,
    reset: false,
  });

  const env = renderEnv(config);
  assert.match(env, /TIDB_HOST=gateway01\.ap-northeast-1\.prod\.aws\.tidbcloud\.com/);
  assert.match(env, /TIDB_PORT=4000/);
  assert.match(env, /TIDB_USER=abc\.root/);
  assert.match(env, /TIDB_PASSWORD="secret#value with spaces"/);
  assert.match(env, /TIDB_DATABASE=test/);
  assert.match(env, /TIDB_SSL=true/);
  assert.match(env, /TIDB_RESET=false/);
});

test('falls back to connectionString and supports CLI overrides', () => {
  const config = parseTidbZeroResponse(
    {
      instance: {
        connectionString: 'mysql://user%40example:p%40ss%2Fword@host.example.com:4001/app_db?ssl=false',
      },
    },
    { database: 'override_db', ssl: true, reset: true },
  );

  assert.equal(config.host, 'host.example.com');
  assert.equal(config.port, 4001);
  assert.equal(config.user, 'user@example');
  assert.equal(config.password, 'p@ss/word');
  assert.equal(config.database, 'override_db');
  assert.equal(config.ssl, true);
  assert.equal(config.reset, true);
});

test('redacted preview does not expose password', () => {
  const config = parseTidbZeroResponse(sampleResponse);
  const preview = redactedEnvPreview(config);
  assert.match(preview, /TIDB_PASSWORD="<redacted>"/);
  assert.doesNotMatch(preview, /secret#value/);
});

test('throws a useful error for incomplete responses', () => {
  assert.throws(
    () => parseTidbZeroResponse({ instance: { connection: { host: 'example.com', port: 4000 } } }),
    (error: unknown) => error instanceof TidbZeroEnvError && /username/.test(error.message),
  );
});

test('runCli converts a saved response without logging secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tidb-zero-env-'));
  const responsePath = join(dir, 'tidb-zero.json');
  const envPath = join(dir, '.env');
  await writeFile(responsePath, `${JSON.stringify(sampleResponse)}\n`);

  let stdout = '';
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    await runCli(['--', '--from', responsePath, '--env', envPath]);
  } finally {
    process.stdout.write = originalWrite;
  }

  const generated = await readFile(envPath, 'utf8');
  assert.match(generated, /TIDB_PASSWORD="secret#value with spaces"/);
  assert.match(stdout, /password redacted/);
  assert.doesNotMatch(stdout, /secret#value/);
});

test('runCli forces overwritten secret files to 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tidb-zero-env-mode-'));
  const responsePath = join(dir, 'tidb-zero.json');
  const envPath = join(dir, '.env');
  await writeFile(responsePath, `${JSON.stringify(sampleResponse)}\n`);
  await writeFile(envPath, 'TIDB_PASSWORD=old-secret\n', { mode: 0o644 });
  await chmod(envPath, 0o644);

  await runCli(['--', '--from', responsePath, '--env', envPath, '--force']);

  const mode = (await stat(envPath)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('runCli forces overwritten API response files to 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tidb-zero-response-mode-'));
  const responsePath = join(dir, 'tidb-zero.json');
  const envPath = join(dir, '.env');
  await writeFile(responsePath, '{"old":true}\n', { mode: 0o644 });
  await chmod(responsePath, 0o644);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(sampleResponse), { status: 200 })) as typeof fetch;
  try {
    await runCli(['--', '--create', '--response', responsePath, '--env', envPath, '--force']);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const mode = (await stat(responsePath)).mode & 0o777;
  assert.equal(mode, 0o600);
});
