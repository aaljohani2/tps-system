import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {buildDraftPlan} from './planner.js';
import {validateRequest} from './validation.js';
import {importCurriculumCsv} from './importer.js';
import {importCatalogXlsx} from './xlsx-import.js';
import {optimizeWithTimefold} from './optimizer.js';
import {defaultPolicy} from './policy.js';
import type {PlanRequest} from './types.js';

const host = process.env.HOST ?? '127.0.0.1'; // No authentication: local-only development preview.
const port = Number(process.env.PORT ?? '8787');
const maxBytes = Number(process.env.MAX_REQUEST_BYTES ?? '5242880');
function reply(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'access-control-allow-origin': 'http://localhost:8787'});
  res.end(JSON.stringify(payload));
}
async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > maxBytes) throw new Error('Request body exceeds size limit.');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
async function readJson(req: IncomingMessage): Promise<unknown> {return JSON.parse((await readRaw(req)).toString('utf8'));}
const publicFiles: Record<string, {file: string; type: string}> = {
  '/': {file: 'web/index.html', type: 'text/html; charset=utf-8'},
  '/app.js': {file: 'web/app.js', type: 'text/javascript; charset=utf-8'},
  '/style.css': {file: 'web/style.css', type: 'text/css; charset=utf-8'},
  '/example.json': {file: 'examples/onsite.json', type: 'application/json; charset=utf-8'},
  '/templates/courses.xlsx': {file: 'web/templates/TPS_Course_Demand_144720.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
  '/templates/curriculum.csv': {file: 'web/templates/TPS_Curriculum_144720.csv', type: 'text/csv; charset=utf-8'}
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
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, {status: 'ok', version: '0.2.0'});
  if (req.method === 'GET' && req.url === '/api/v1/policy/default') return reply(res, 200, defaultPolicy());
  if (req.method === 'POST' && req.url === '/api/v1/catalog/import-csv') {
    if (!(req.headers['content-type'] ?? '').startsWith('text/csv')) return reply(res, 415, {error: 'text/csv required'});
    try {
      const bytes = await readRaw(req);
      return reply(res, 200, importCurriculumCsv(bytes.toString('utf8')));
    } catch (e) {return reply(res, 400, {error: e instanceof Error ? e.message : 'Invalid CSV'});}
  }
  if (req.method === 'POST' && req.url === '/api/v1/catalog/import-xlsx') {
    if (!(req.headers['content-type'] ?? '').startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
      return reply(res, 415, {error: 'XLSX content type required'});
    try {
      return reply(res, 200, await importCatalogXlsx(await readRaw(req)));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid XLSX';
      const unavailable = /ENOENT|not found|Cannot find|No module named/.test(message);
      return reply(res, unavailable ? 503 : /size limit|5 MiB/.test(message) ? 413 : 400,
        {error: unavailable ? 'XLSX importer unavailable; install Python 3 and openpyxl locally' : message});
    }
  }
  if (req.method === 'POST' && req.url === '/api/v1/plans/optimize') {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return reply(res, 415, {error: 'JSON required'});
    try {
      const data = await readJson(req);
      validateRequest(data as PlanRequest);
      return reply(res, 200, await optimizeWithTimefold(data as PlanRequest));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Timefold unavailable';
      const status = /ENOENT|timed out|Solver exited|Timefold|JAR|jar|spawn/.test(message) ? 503 : 400;
      return reply(res, status, {error: message, note: 'No optimizer fallback: call /api/v1/plans/preview for explicitly labeled greedy draft.'});
    }
  }
  if (req.method === 'POST' && req.url === '/api/v1/plans/preview') {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return reply(res, 415, {error: 'JSON required'});
    try {
      const data = await readJson(req);
      return reply(res, 200, buildDraftPlan(data as PlanRequest));
    } catch (e) {return reply(res, 400, {error: e instanceof Error ? e.message : 'Invalid input'});}
  }
  return reply(res, 404, {error: 'Not found'});
});
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // On purpose, never bind to all interfaces by default before auth + TLS + RBAC exist.
  app.listen(port, host, () => console.log(`TPS development API: http://${host}:${port}`));
}
