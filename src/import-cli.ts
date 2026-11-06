import {readFileSync, writeFileSync} from 'node:fs';
import {importCurriculumCsv} from './importer.js';
const path = process.argv[2];
if (!path) {console.error('Usage: npm run import:csv -- <source.csv> [output.json]'); process.exit(2);}
try {
  const catalog = importCurriculumCsv(readFileSync(path, 'utf8'));
  const text = JSON.stringify(catalog, null, 2);
  if (process.argv[3]) writeFileSync(process.argv[3]!, text + '\n', {flag:'w'});
  else console.log(text);
} catch (e) {console.error(e instanceof Error ? e.message : 'Import failed'); process.exit(1);}
