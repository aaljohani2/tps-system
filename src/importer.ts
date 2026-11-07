/** Read-only curriculum catalog import, no learner-level data and no inferred enrollment. */
import type {Course} from './types.js';

export interface CatalogImport {
  schemaVersion: 'tps.catalog.v1';
  courses: Course[];
  ignored: Array<{row: number; code: string; reason: string}>;
  warnings: string[];
  sourceRows: number;
}

/** RFC4180 quotes, escaped quotes, CRLF, multiline cells and UTF-8 BOM. */
export function parseCsv(raw: string, delimiter = ','): string[][] {
  if(![',',';','\t'].includes(delimiter))throw new Error('Unsupported CSV delimiter');
  const content = raw.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {cell += '"'; i++;}
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      if (cell !== '') throw new Error(`Malformed CSV quote at position ${i}`);
      quoted = true;
    } else if (ch === delimiter) {row.push(cell); cell = '';}
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('Unclosed CSV quoted field');
  if (row.length || cell !== '') {row.push(cell); rows.push(row);}
  return rows.filter(r => r.some(x => x.trim()));
}

const LEVEL_WORDS: Record<string, number> = {'الأول': 1, 'الثاني': 2, 'الثالث': 3, 'الرابع': 4, 'الخامس': 5,
  'السادس': 6, 'السابع': 7, 'الثامن': 8, 'التاسع': 9, 'العاشر': 10};
function level(text: string): number {
  const value = text.replace(/\s+/g, ' ').trim();
  for (const [word, number] of Object.entries(LEVEL_WORDS)) if (value.includes(word)) return number;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 0;
}
function wholeNumber(value: string, field: string, row: number): number {
  const cleaned = value.trim().replace(/[٠-٩]/g, s => String('٠١٢٣٤٥٦٧٨٩'.indexOf(s)))
    .replace(/[۰-۹]/g, s => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(s)));
  const number = Number(cleaned);
  if (!Number.isSafeInteger(number) || number < 0 || number > 120) throw new Error(`Row ${row}: invalid ${field}: ${value}`);
  return number;
}
function clean(text: string): string {return text.trim().replace(/\s+/g, ' ');}

/** TVTC/semester plan CSV: مح=lectures, عم=lab, تم=tutorial. Tutorials are provisionally counted under theory. */
export function importCurriculumCsv(raw: string): CatalogImport {
  if (Buffer.byteLength(raw, 'utf8') > 3_000_000) throw new Error('Catalog CSV is too large');
  const data = parseCsv(raw);
  if (!data.length) throw new Error('Empty CSV');
  const headers = data[0]!.map(clean);
  const get = (row: string[], name: string) => row[headers.lastIndexOf(name)] ?? '';
  for (const name of ['المقرر', 'اسم المقرر', 'الفصل التدريبي', 'مح', 'عم', 'تم']) {
    if (!headers.includes(name)) throw new Error(`Required catalog column missing: ${name}`);
  }
  const result: CatalogImport = {schemaVersion: 'tps.catalog.v1', courses: [], ignored: [], warnings: [], sourceRows: data.length - 1};
  const codes = new Set<string>();
  let tutorialCourses = 0;
  for (const [i, row] of data.slice(1).entries()) {
    const rowNumber = i + 2;
    const code = clean(get(row, 'المقرر'));
    const title = clean(get(row, 'اسم المقرر'));
    if (!code && !title) continue;
    if (!code || !title) throw new Error(`Row ${rowNumber}: missing code/title`);
    if (codes.has(code)) throw new Error(`Duplicate course code at row ${rowNumber}: ${code}`);
    codes.add(code);
    if (/المشروع|مشروع إنتاجي/.test(title)) {
      result.ignored.push({row: rowNumber, code, reason: 'PROJECT_EXCLUDED_BY_POLICY'}); continue;
    }
    const levelNumber = level(get(row, 'الفصل التدريبي'));
    if (!levelNumber) throw new Error(`Row ${rowNumber}: unknown term level ${get(row, 'الفصل التدريبي')}`);
    const theory = wholeNumber(get(row, 'مح'), 'lecture hours', rowNumber);
    const practical = wholeNumber(get(row, 'عم'), 'practical hours', rowNumber);
    const tutorials = wholeNumber(get(row, 'تم'), 'tutorial hours', rowNumber);
    const contactDeclared = get(row, 'س')?.trim();
    if (contactDeclared && wholeNumber(contactDeclared, 'contact hours', rowNumber) !== theory + practical + tutorials)
      result.warnings.push(`Row ${rowNumber}: declared weekly contact differs from lecture+practical+tutorial hours`);
    if (tutorials) tutorialCourses++;
    if (theory + practical + tutorials === 0) {
      result.ignored.push({row: rowNumber, code, reason: 'NO_WEEKLY_CONTACT_HOURS_COOP_OR_OTHER'});
      continue;
    }
    result.courses.push({code, title, level: levelNumber, demand: 0,
      theoryHours: theory + tutorials, practicalHours: practical, mode: 'ONSITE', eligibleModes: ['ONSITE']});
  }
  if (tutorialCourses) result.warnings.push(`${tutorialCourses} course(s) contain tutorial (تم) hours provisionally grouped with theory; verify the actual room requirement before scheduling.`);
  result.warnings.push('Demand is 0 by design. Import learner counts separately; plan catalog is not an enrollment report.');
  result.warnings.push('All modes default to ONSITE. Remote, self-paced and hybrid require separate authorization.');
  return result;
}
