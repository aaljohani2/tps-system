"""Read a provisional matrix workbook without altering it or inventing times/rosters."""
import argparse
import datetime as dt
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import unquote

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

DAYS = {"الاحد": "SUN", "الاثنين": "MON", "الثلاثاء": "TUE", "الاربعاء": "WED", "الخميس": "THU"}
LEVELS = {"الاول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5}


def norm(value):
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = re.sub(r"[\u064b-\u065f\u0670\u200e\u200f\u202a-\u202e\u0640]", "", text)
    return re.sub(r"\s+", " ", text.translate(str.maketrans("أإآىة", "ااايه"))).strip()


def raw_value(value):
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return {"type": type(value).__name__, "value": value.isoformat()}
    return {"type": type(value).__name__, "value": value}


def clock(value):
    """Literal 24-hour value only. No guessed AM/PM conversion."""
    if isinstance(value, dt.time):
        return value.hour * 60 + value.minute if value.second == 0 else None
    if isinstance(value, (float, int)) and 0 <= value < 1:
        minutes = value * 1440
        return round(minutes) if abs(minutes - round(minutes)) < 1e-6 else None
    if isinstance(value, str) and re.fullmatch(r"\d{1,2}:\d{2}(?::00)?", value.strip()):
        hour, minute = map(int, value.strip().split(":")[:2])
        return hour * 60 + minute if hour < 24 and minute < 60 else None
    return None


def parse_workbook(path, reference=None, received_at=None):
    path = Path(path)
    if not path.is_file() or path.stat().st_size > 20_000_000:
        raise ValueError("Source workbook missing or over 20 MB")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if reference and reference.get("original_workbook_sha256") != digest:
        raise ValueError("Workbook does not match the extracted JSON SHA-256")
    book = load_workbook(path, data_only=False, read_only=False)
    if len(book.worksheets) > 20:
        raise ValueError("Too many worksheets")
    raw = {"file": str(path.resolve()), "originalFilename": path.name, "displayFilename": unquote(path.name),
           "sha256": digest, "receivedAt": received_at, "status": "PROVISIONAL", "sheets": []}
    items, issues = [], []

    def issue(code, sheet, cells, message, item_id=None):
        issues.append({"code": code, "sheet": sheet, "cells": cells, "message": message,
                       **({"itemId": item_id} if item_id else {})})

    for sheet in book:
        if sheet.max_row > 2000 or sheet.max_column > 100:
            raise ValueError("Matrix exceeds bounded parser dimensions")
        cells = [{"cell": cell.coordinate, **raw_value(cell.value), "numberFormat": cell.number_format,
                  "dataType": cell.data_type} for row in sheet for cell in row if cell.value is not None]
        raw["sheets"].append({"name": sheet.title, "dimension": sheet.calculate_dimension(),
                              "mergedRanges": [str(r) for r in sheet.merged_cells.ranges], "cells": cells})
        if reference:
            expected = reference.get("sheets", {}).get(sheet.title, {}).get("cells", [])
            actual = {c["cell"]: sheet[c["cell"]].value for c in cells}
            if len(expected) != len(actual):
                raise ValueError("Extracted JSON cell count differs: " + sheet.title)
            for cell in expected:
                value = actual.get(cell["cell"])
                old = cell.get("raw_value")
                if clock(value) is not None and isinstance(old, (int, float)):
                    valid = clock(value) == clock(old)
                else:
                    valid = value == old
                if not valid:
                    raise ValueError("Extracted JSON cell differs: " + sheet.title + "!" + cell["cell"])
        headers = []
        for row in sheet:
            for cell in row:
                text = norm(cell.value)
                match = re.fullmatch(r"المستوي (الاول|الثاني|الثالث|الرابع|الخامس)\s*[-–]\s*شعبه\s*(\d+)", text)
                if match:
                    headers.append((cell.row, cell.column, LEVELS[match[1]], int(match[2]), cell.coordinate))
        for row, col, level, group, header in headers:
            stop = min([r for r, c, *_ in headers if c == col and r > row] or [sheet.max_row + 1])
            group_id = f"{sheet.title}:L{level}:G{group}"
            for rr in range(row + 2, stop):
                for cc in range(col + 1, min(col + 6, sheet.max_column + 1)):
                    cell = sheet.cell(rr, cc)
                    if cell.value is None:
                        continue
                    title = str(cell.value)
                    title_norm = norm(title)
                    if title_norm in DAYS or clock(cell.value) is not None:
                        continue
                    if title_norm in ("ذاتي", "الغاء"):
                        issue("STANDALONE_MARKER", sheet.title, [cell.coordinate], title)
                        continue
                    if cell.data_type == "f":
                        issue("FORMULA_NOT_EVALUATED", sheet.title, [cell.coordinate], "Formula is retained without evaluation")
                        continue
                    merged = next((area for area in sheet.merged_cells.ranges if cell.coordinate in area), None)
                    end_row = merged.max_row if merged else rr
                    day_cell = sheet.cell(row + 1, cc)
                    start_cell, end_cell = sheet.cell(rr, col), sheet.cell(end_row, col)
                    evidence = [header, cell.coordinate]
                    if norm(day_cell.value) not in DAYS and col == 10:
                        day_cell = sheet.cell(row + 1, cc - 9)
                    if start_cell.value is None and col == 10:
                        start_cell = sheet.cell(rr, 1)
                    if end_cell.value is None and col == 10:
                        end_cell = sheet.cell(end_row, 1)
                    evidence.extend([day_cell.coordinate, start_cell.coordinate, end_cell.coordinate])
                    next_cell = sheet.cell(rr + 1, cc)
                    self_paced = "ذاتي" in title_norm or (not merged and norm(next_cell.value) == "ذاتي")
                    if self_paced and "ذاتي" not in title_norm:
                        evidence.append(next_cell.coordinate)
                    kind = "CANCELLED" if "الغاء" in title_norm else "SELF_PACED" if self_paced else "DAY"
                    start, end = clock(start_cell.value), clock(end_cell.value)
                    valid_time = start is not None and end is not None and end > start
                    item_id = f"{sheet.title}!{cell.coordinate}"
                    item = {"id": item_id, "sheet": sheet.title, "level": level, "sourceGroup": group_id,
                            "sourceGroupNumber": group, "headerCell": header, "sourceCells": list(dict.fromkeys(evidence)),
                            "rawTitle": title, "normalizedTitle": title_norm, "kind": kind,
                            "day": DAYS.get(norm(day_cell.value)), "literalStartMinute": start, "literalEndMinute": end,
                            "startMinute": start if valid_time and kind == "DAY" else None,
                            "endMinute": end if valid_time and kind == "DAY" else None,
                            "timingStatus": "EXPLICIT_INTERVAL" if valid_time else "AMBIGUOUS_OR_MISSING",
                            "identifiersUnverified": re.findall(r"\b\d{4,}\b", title), "relation": "SINGLE_SOURCE_OCCURRENCE"}
                    items.append(item)
                    if kind == "DAY" and not valid_time:
                        issue("AMBIGUOUS_INTERVAL", sheet.title, item["sourceCells"], "No confirmed end after start; literal source times retained", item_id)
                    if not item["day"]:
                        issue("MISSING_DAY", sheet.title, item["sourceCells"], "Day not documented", item_id)
                    if item["identifiersUnverified"]:
                        issue("UNVERIFIED_IDENTIFIER", sheet.title, [cell.coordinate], "Digits are not established Rayat section IDs", item_id)
            evening_col = col + 6
            if evening_col + 2 > sheet.max_column:
                continue
            for rr in range(row + 2, stop):
                cell = sheet.cell(rr, evening_col)
                if cell.value is None:
                    continue
                title, title_norm = str(cell.value), norm(cell.value)
                if title_norm in ("المقرر", "اليوم", "الوقت", "المحاضرات المساييه") or clock(cell.value) is not None:
                    continue
                day_cell, time_cell = sheet.cell(rr, evening_col + 1), sheet.cell(rr, evening_col + 2)
                item_id = f"{sheet.title}!{cell.coordinate}"
                item = {"id": item_id, "sheet": sheet.title, "level": level, "sourceGroup": group_id,
                        "sourceGroupNumber": group, "headerCell": header,
                        "sourceCells": [header, cell.coordinate, day_cell.coordinate, time_cell.coordinate],
                        "rawTitle": title, "normalizedTitle": title_norm,
                        "kind": "CANCELLED" if "الغاء" in title_norm else "SELF_PACED" if "ذاتي" in title_norm else "EVENING",
                        "day": DAYS.get(norm(day_cell.value)), "literalStartMinute": clock(time_cell.value), "literalEndMinute": None,
                        "startMinute": None, "endMinute": None, "timingStatus": "MISSING_DURATION",
                        "identifiersUnverified": re.findall(r"\b\d{4,}\b", title), "relation": "UNRESOLVED_DAY_EVENING"}
                items.append(item)
                if item["kind"] == "EVENING":
                    issue("EVENING_DURATION_UNKNOWN", sheet.title, item["sourceCells"], "Evening time has no documented duration or delivery mode", item_id)
                    if not item["day"] or item["literalStartMinute"] is None:
                        issue("INCOMPLETE_EVENING", sheet.title, item["sourceCells"], "Day or start is missing", item_id)
        for cell in cells:
            if norm(cell["value"]) in ("ذاتي", "الغاء") and not any(cell["cell"] in i["sourceCells"] for i in items if i["sheet"] == sheet.title):
                issue("UNATTACHED_MARKER", sheet.title, [cell["cell"]], str(cell["value"]))
    book.close()
    return raw, items, issues


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook")
    parser.add_argument("--reference")
    parser.add_argument("--received-at", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    reference = json.loads(Path(args.reference).read_text(encoding="utf-8-sig")) if args.reference else None
    dt.date.fromisoformat(args.received_at)
    raw, normalized, issues = parse_workbook(args.workbook, reference, args.received_at)
    target = Path(args.output)
    target.mkdir(parents=True, exist_ok=True)
    for name, value in [("general_courses_raw", raw), ("general_courses_normalized", normalized), ("general_courses_issues", issues)]:
        (target / (name + ".json")).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "PARSED", "sha256": raw["sha256"], "sheets": len(raw["sheets"]),
                      "items": len(normalized), "issues": len(issues)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
