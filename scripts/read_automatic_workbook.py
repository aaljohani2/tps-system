import json
import os
import sys

from openpyxl import load_workbook


def fail(message: str) -> None:
    print(json.dumps({"error": message}, ensure_ascii=False))
    raise SystemExit(2)


def main() -> None:
    if len(sys.argv) != 2:
        fail("Workbook path is required")
    path = sys.argv[1]
    if not os.path.isfile(path) or os.path.getsize(path) > 20 * 1024 * 1024:
        fail("Workbook must exist and be no larger than 20 MiB")
    try:
        workbook = load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:
        fail("Invalid XLSX workbook: " + str(exc)[:240])
    if len(workbook.sheetnames) > 30:
        fail("Workbook contains too many sheets")
    sheets = []
    total_cells = 0
    for sheet in workbook.worksheets:
        if (sheet.max_row or 0) > 100000 or (sheet.max_column or 0) > 200:
            fail("Workbook sheet exceeds 100000 rows or 200 columns")
        total_cells += (sheet.max_row or 0) * (sheet.max_column or 0)
        if total_cells > 2_000_000:
            fail("Workbook exceeds 2000000 cells")
        rows = []
        for row in sheet.iter_rows(values_only=True):
            values = ["" if value is None else str(value) for value in row]
            while values and values[-1] == "":
                values.pop()
            if any(value.strip() for value in values):
                rows.append(values)
        sheets.append({"name": sheet.title, "rows": rows})
    print(json.dumps({"sheets": sheets}, ensure_ascii=False))


if __name__ == "__main__":
    main()
