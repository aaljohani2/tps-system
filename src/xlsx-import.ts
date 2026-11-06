/** Local-only bounded XLSX import adapter. Do not expose before auth/RBAC are implemented. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {CatalogImport} from './importer.js';

const exec = promisify(execFile);
const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));

export async function importCatalogXlsx(bytes: Buffer, options: {python?: string; script?: string} = {}): Promise<CatalogImport> {
  if (!bytes.length || bytes.length > MAX_XLSX_BYTES) throw new Error('XLSX size must be 1 byte to 5 MiB');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Invalid XLSX file signature');
  const dir = await mkdtemp(join(tmpdir(), 'tps-xlsx-'));
  try {
    const filepath = join(dir, 'upload.xlsx');
    await writeFile(filepath, bytes, {mode: 0o600});
    const script = options.script ?? resolve(root, 'scripts/import_xlsx.py');
    const python = options.python ?? process.env.TPS_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    let stdout: string;
    try {
      ({stdout} = await exec(python, [script, filepath], {cwd: root, timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024, windowsHide: true}));
    } catch (e) {
      const err = e as Error & {code?: string;stderr?: string};
      if (err.code === 'ENOENT') throw new Error('Python executable not found');
      const detail = (err.stderr ?? '').trim().replace(/^Import failed:\s*/,'');
      if (/No module named|ModuleNotFoundError/.test(detail)) throw new Error('Python openpyxl module not found');
      throw new Error((detail || 'Invalid XLSX workbook').slice(0, 400));
    }
    const result: unknown = JSON.parse(stdout);
    if (!result || typeof result !== 'object' || (result as {schemaVersion?: string}).schemaVersion !== 'tps.catalog.v1' ||
        !Array.isArray((result as {courses?: unknown}).courses)) throw new Error('Unexpected XLSX importer output');
    return result as CatalogImport;
  } finally {
    await rm(dir, {force: true, recursive: true});
  }
}
