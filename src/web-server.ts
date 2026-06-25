#!/usr/bin/env node
import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import {
  connectionConfigFromInput,
  connectionDefaultsFromEnv,
  dryRunPlan,
  formatStepError,
  healthCheck,
  initializeAndImport,
  inspectTable,
  parseEmbeddingLiteral,
  parseTopK,
  runFullTextSearch,
  runVectorSearch,
  type TiDbConnectionInput
} from './tidb-demo.js';

interface ApiRequestBody {
  connection?: TiDbConnectionInput;
  reset?: boolean;
  topK?: number | string;
  vectorQuery?: string | number[];
  fullTextQuery?: string;
}

const publicRoot = join(process.cwd(), 'public');
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(body, null, 2));
}

async function readBody(request: IncomingMessage): Promise<ApiRequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const totalBytes = chunks.reduce((sum, item) => sum + item.byteLength, 0);
    if (totalBytes > 64_000) throw new Error('Request body is too large.');
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ApiRequestBody;
}

async function handleApi(pathname: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'GET' && pathname === '/api/defaults') {
    sendJson(response, 200, {
      ok: true,
      defaults: connectionDefaultsFromEnv(),
      dryRun: dryRunPlan()
    });
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
    return;
  }

  try {
    const body = await readBody(request);
    const config = connectionConfigFromInput(body.connection ?? {});
    const topK = parseTopK(body.topK, 3);

    if (pathname === '/api/connect') {
      sendJson(response, 200, await healthCheck(config));
      return;
    }
    if (pathname === '/api/initialize') {
      sendJson(response, 200, await initializeAndImport(config, Boolean(body.reset)));
      return;
    }
    if (pathname === '/api/vector-search') {
      const query = parseEmbeddingLiteral(body.vectorQuery);
      sendJson(response, 200, await runVectorSearch(config, query, topK));
      return;
    }
    if (pathname === '/api/fulltext-search') {
      const query = typeof body.fullTextQuery === 'string' && body.fullTextQuery.trim()
        ? body.fullTextQuery.trim()
        : dryRunPlan().fullTextQuery;
      sendJson(response, 200, await runFullTextSearch(config, query, topK));
      return;
    }
    if (pathname === '/api/inspect') {
      sendJson(response, 200, await inspectTable(config));
      return;
    }

    sendJson(response, 404, { ok: false, message: 'Unknown API route.' });
  } catch (error) {
    sendJson(response, 400, formatStepError(error));
  }
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const relativePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(publicRoot, relativePath));
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}/`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    });
    response.end(data);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(url.pathname, request, response);
      return;
    }
    await serveStatic(url.pathname, response);
  })().catch((error: unknown) => {
    sendJson(response, 500, formatStepError(error));
  });
});

server.listen(port, host, () => {
  console.log(`TiDB Zero step UI: http://${host}:${port}`);
});
