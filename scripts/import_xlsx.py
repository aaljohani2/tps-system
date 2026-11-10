#!/usr/bin/env python3
"""Import the user's planning XLSX catalog into the TPS v1 catalog JSON contract.

This tool intentionally reads course-level totals only (no student PII), never evaluates formulas,
and never automatically authorizes remote/self-paced/hybrid modes.
Requires: pip install openpyxl
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
from openpyxl import load_workbook

FIELDS = {
    'code': ('رمز المقرر', 'المقرر'),
    'title': ('اسم المقرر',),
    'level': ('المستوى',),
    'demand': ('الطلب المتوقع', 'عدد المتدربين', 'المسجلون'),
    'theory': ('نظري + تمارين', 'النظري', 'ساعات نظري'),
    'practical': ('عملي', 'ساعات عملي'),
}

def find_col(headings: list[str], aliases: tuple[str, ...]) -> int | None:
    for a in aliases:
        if a in headings:
            return headings.index(a)
    return None

def integer(row_num: int, label: str, value: object, cap: int = 100_000) -> int:
    if isinstance(value, bool):
        raise ValueError(f'Row {row_num}: invalid {label}')
    if isinstance(value, (int, float)) and int(value) == value and 0 <= value <= cap:
        return int(value)
    if isinstance(value, str) and value.strip().isdigit() and int(value) <= cap:
        return int(value)
    raise ValueError(f'Row {row_num}: {label} must be a nonnegative integer, got {value!r}')

def parse(path: Path, tab: str | None = None) -> dict:
    if path.stat().st_size > 15_000_000:
        raise ValueError('XLSX is too large')
    wb = load_workbook(path, read_only=True, data_only=True)
    if tab and tab not in wb.sheetnames:
        raise ValueError(f'Unknown worksheet {tab}')
    sheets = [wb[tab]] if tab else [wb[n] for n in wb.sheetnames]
    candidates = []
    for ws in sheets:
        for idx, row in enumerate(ws.iter_rows(min_row=1, max_row=min(ws.max_row or 20, 20), values_only=True), start=1):
            headings = [str(x).strip() if x is not None else '' for x in row]
            if all(find_col(headings, FIELDS[k]) is not None for k in ['code', 'title', 'level', 'demand', 'theory', 'practical']):
                candidates.append((ws, idx, headings))
                break
    if not candidates:
        raise ValueError('No supported course catalog found: expected course/name/level/demand/theory/practical columns')
    ws, row_at, headings = candidates[0]
    columns = {k: find_col(headings, aliases) for k, aliases in FIELDS.items()}
    imported = []; ignored = []; seen = set()
    for ri, row in enumerate(ws.iter_rows(min_row=row_at + 1, values_only=True), start=row_at + 1):
        def v(field):
            col = columns[field]
            return row[col] if col is not None and col < len(row) else None
        code, title = str(v('code') or '').strip(), str(v('title') or '').strip()
        if not code and not title: continue
        if not code or not title: raise ValueError(f'Row {ri}: missing course code/name')
        if code in seen: raise ValueError(f'Row {ri}: duplicate course code {code}')
        seen.add(code)
        if 'مشروع' in title:
            ignored.append({'row': ri, 'code': code, 'reason': 'PROJECT_EXCLUDED_BY_POLICY'}); continue
        level = integer(ri, 'level', v('level'), 12)
        demand = integer(ri, 'demand', v('demand'))
        theory = integer(ri, 'theory', v('theory'), 80)
        practical = integer(ri, 'practical', v('practical'), 80)
        if not level: raise ValueError(f'Row {ri}: level must be 1..12')
        if not theory and not practical:
            ignored.append({'row': ri, 'code': code, 'reason': 'NO_WEEKLY_CONTACT_HOURS_COOP_OR_OTHER'}); continue
        imported.append({'code': code, 'title': title, 'level': level, 'demand': demand,
                         'theoryHours': theory, 'practicalHours': practical,
                         'mode': 'ONSITE', 'eligibleModes': ['ONSITE']})
    return {'schemaVersion': 'tps.catalog.v1', 'courses': imported, 'ignored': ignored,
            'sourceRows': len(imported) + len(ignored),
            'warnings': ['Delivery modes are intentionally reset to ONSITE: request explicit course authorization before enabling optional modes.',
                         'Demand is read from the selected course-level demand column; verify it excludes other specializations and duplicates.',
                         'No student identifiers are imported. External department courses must be allocated separately.']}

if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('file', type=Path)
    cli.add_argument('--sheet', help='Named worksheet containing course catalog')
    cli.add_argument('--out', type=Path, help='Output JSON file; stdout by default')
    args = cli.parse_args()
    try:
        parsed = parse(args.file, args.sheet)
        content = json.dumps(parsed, ensure_ascii=False, indent=2) + '\n'
        if args.out:
            args.out.write_text(content, encoding='utf-8')
        else:
            sys.stdout.write(content)
    except Exception as e:
        print(f'Import failed: {e}', file=sys.stderr)
        sys.exit(1)
