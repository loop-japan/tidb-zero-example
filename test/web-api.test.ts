import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectionConfigFromInput,
  dryRunPlan,
  formatStepError,
  parseEmbeddingLiteral,
  parseTopK,
  redactConfig
} from '../src/tidb-demo.js';

test('web helpers validate connection input and redact secrets', () => {
  const config = connectionConfigFromInput({
    host: 'example.tidbcloud.com',
    port: '4000',
    user: 'abc123.root',
    password: 'secret',
    database: 'test',
    ssl: true
  });

  assert.equal(config.host, 'example.tidbcloud.com');
  assert.equal(config.port, 4000);
  assert.equal(config.password, 'secret');
  assert.deepEqual(redactConfig(config), {
    host: 'example.tidbcloud.com',
    port: 4000,
    user: 'abc***',
    database: 'test',
    ssl: true
  });
});

test('step query helpers preserve demo defaults and validate bounds', () => {
  assert.equal(parseEmbeddingLiteral('[0.9, 0.08, 0.02]'), '[0.9,0.08,0.02]');
  assert.equal(parseEmbeddingLiteral('0.9,0.08,0.02'), '[0.9,0.08,0.02]');
  assert.equal(parseEmbeddingLiteral(undefined), dryRunPlan().vectorQuery);
  assert.equal(parseTopK('4'), 4);
  assert.throws(() => parseTopK('100'), /Top K/);
});

test('API error formatter never exposes stack traces by default', () => {
  const formatted = formatStepError(new Error('boom'));
  assert.deepEqual(formatted, { ok: false, message: 'boom' });
});
