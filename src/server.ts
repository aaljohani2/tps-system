import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {buildDraftPlan} from './planner.js';
import {defaultPolicy} from './policy.js';
import type {PlanRequest} from './types.js';

const host = process.env.HOST ?? '127.0.0.1'; // No authentication: local-only development preview.
const port = Number(process.env.PORT ?? '8787');
const maxBytes = Number(process.env.MAX_REQUEST_BYTES ?? '1048576');
function reply(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'access-control-allow-origin': 'http://localhost:8787'});
  res.end(JSON.stringify(payload));
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > maxBytes) throw new Error('Request body exceeds size limit.');
    chunks.push(b);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const publicFiles: Record<string, {file: string; type: string}> = {
  '/': {file: 'web/index.html', type: 'text/html; charset=utf-8'},
  '/app.js': {file: 'web/app.js', type: 'text/javascript; charset=utf-8'},
  '/style.css': {file: 'web/style.css', type: 'text/css; charset=utf-8'},
  '/example.json': {file: 'examples/onsite.json', type: 'application/json; charset=utf-8'}
};
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const app = createServer(async (req, res) => {
  const asset = req.method === 'GET' ? publicFiles[req.url ?? ''] : undefined;
  if (asset) {
    try {const content = await readFile(resolve(root, asset.file));
      res.writeHead(200, {'content-type': asset.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
      return res.end(content);
    } catch {return reply(res, 500, {error:'Static asset missing'});}
  }
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, {status: 'ok', version: '0.1.0'});
  if (req.method === 'GET' && req.url === '/api/v1/policy/default') return reply(res, 200, defaultPolicy());
  if (req.method === 'POST' && req.url === '/api/v1/plans/preview') {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return reply(res, 415, {error: 'JSON required'});
    try {
      const data = await readJson(req);
      return reply(res, 200, buildDraftPlan(data as PlanRequest));
    } catch (e) {return reply(res, 400, {error: e instanceof Error ? e.message : 'Invalid input'});}
  }
  return reply(res, 404, {error: 'Not found'});
});
if (process.argv[1]?.endsWith('/server.js')) {
  // On purpose, never bind to all interfaces by default before auth + TLS + RBAC exist.
  app.listen(port, host, () => console.log(`TPS development API: http://${host}:${port}`));
}
