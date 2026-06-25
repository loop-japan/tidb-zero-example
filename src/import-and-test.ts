#!/usr/bin/env node
import 'dotenv/config';
import {
  boolEnv,
  connectionConfigFromEnv,
  dryRunPlan,
  formatStepError,
  parseTopK,
  runDemo
} from './tidb-demo.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const topK = parseTopK(process.env.TOP_K, 3);

async function main(): Promise<void> {
  if (dryRun) {
    console.log(JSON.stringify(dryRunPlan(), null, 2));
    return;
  }

  const config = connectionConfigFromEnv();
  const reset = boolEnv('TIDB_RESET', false);
  const result = await runDemo(config, { reset, topK });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'live',
    ...formatStepError(error)
  }, null, 2));
  process.exitCode = 1;
});
