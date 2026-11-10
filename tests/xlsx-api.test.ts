import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {app} from '../src/server.js';
import {importCatalogXlsx} from '../src/xlsx-import.js';

const url = async (): Promise<string> => {
  if (!app.listening) {app.listen(0, '127.0.0.1'); await once(app, 'listening');}
  const address = app.address();
  if (!address || typeof address === 'string') throw Error('No local listening TCP port');
  return `http://127.0.0.1:${address.port}`;
};
test('XLSX template can be uploaded and converted into a safe onsite catalog', async () => {
  const template = await readFile('web/templates/TPS_Course_Demand_144720.xlsx');
  const data = await importCatalogXlsx(template);
  assert.equal(data.courses.length, 24);
  assert.ok(data.courses.every(c => c.mode === 'ONSITE' && c.eligibleModes.length === 1));
  assert.ok(data.courses.every(c => c.demand === 0));
  assert.ok(data.courses.some(c => c.theoryHours > 0 && c.practicalHours > 0));
});
test('Web UI serves a downloadable Excel template and POST XLSX imports its demand', async t => {
  const base = await url();
  t.after(() => app.close());
  const tRes = await fetch(`${base}/templates/courses.xlsx`);
  assert.equal(tRes.status, 200);
  assert.match(tRes.headers.get('content-type') ?? '', /spreadsheetml/);
  const bytes = Buffer.from(await tRes.arrayBuffer());
  const r = await fetch(`${base}/api/v1/catalog/import-xlsx`, {
    method: 'POST', headers: {'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}, body: bytes
  });
  assert.equal(r.status, 200);
  const imported = await r.json() as {courses: unknown[];schemaVersion: string};
  assert.equal(imported.courses.length, 24);
  assert.equal(imported.schemaVersion, 'tps.catalog.v1');
});
test('Malformed XLSX, wrong MIME and oversized input are rejected', async () => {
  const base=await url();
  const endpoint=`${base}/api/v1/catalog/import-xlsx`;
  const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const wrong=await fetch(endpoint,{method:'POST',headers:{'content-type':'text/plain'},body:'not xlsx'});
  assert.equal(wrong.status,415);
  const invalid=await fetch(endpoint,{method:'POST',headers:{'content-type':mime},body:'not xlsx'});
  assert.equal(invalid.status,400);
  const large=await fetch(endpoint,{method:'POST',headers:{'content-type':mime},body:Buffer.alloc(5*1024*1024+100)});
  assert.equal(large.status,413);
  app.close();
});
