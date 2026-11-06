#!/usr/bin/env python3
"""Produce a bounded, Arabic RTL Excel workbook from one saved TPS scenario."""
from __future__ import annotations
import json
import sys
from io import BytesIO
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

def safe(value):
    if value is None:
        return ""
    if isinstance(value, (int, float, bool)):
        return value
    value = str(value)
    if value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value[:30000]

def page(book, title, columns, rows):
    ws = book.create_sheet(title)
    ws.sheet_view.rightToLeft = True
    ws.freeze_panes = "A2"
    ws.append(columns)
    for row in rows:
        ws.append([safe(item) for item in row])
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill(fill_type="solid", fgColor="176B73")
        cell.alignment = Alignment(horizontal="right")
    for i, column in enumerate(columns, 1):
        ws.column_dimensions[get_column_letter(i)].width = min(42, max(16, len(column) * 2 + 6))
    ws.print_options.horizontalCentered = True
    ws.page_setup.orientation = "landscape"
    ws.auto_filter.ref = ws.dimensions

def main():
    payload = json.load(sys.stdin)
    metadata = payload.get("metadata") if isinstance(payload, dict) and "plan" in payload else None
    plan = payload.get("plan") if metadata is not None else payload
    if not isinstance(plan, dict) or not isinstance(plan.get("sections"), list):
        raise ValueError("Invalid scenario snapshot")
    book = Workbook()
    book.remove(book.active)
    if metadata:
        page(book, "حالة الاعتماد", ["البيان", "القيمة"], [
            ["حالة الجدول", metadata.get("state", "NOT_APPROVED")],
            ["السيناريو", metadata.get("scenarioName", "")],
            ["الفصل التدريبي", metadata.get("termId", "")],
            ["إصدار سياسة الجدولة", metadata.get("policyRevision", 0)],
            ["تنبيه", "نسخة تخطيطية محلية، لا تُعد تصديرًا رسميًا إلى رايات"]
        ])
    sessions = plan.get("sessions", [])
    page(book, "الجداول",
        ["المقرر", "الشعبة", "المدرب", "القاعة", "النمط", "اليوم", "من", "إلى", "البلوك"],
        [[s.get(k) for k in ("courseCode", "sectionId", "instructorId", "roomId",
                            "mode", "day", "start", "end", "blockId")] for s in sessions])
    page(book, "الشعب",
        ["رمز الشعبة", "المقرر", "المستوى", "المتدربون", "السعة", "النمط", "مدرب", "حالة"],
        [[s.get(k) for k in ("id", "courseCode", "level", "students", "capacity",
                            "mode", "instructorId", "state")] for s in plan["sections"]])
    page(book, "الأنصبة",
        ["المدرب", "النصاب", "الاستثناء", "المكافئ", "الساعات الفعلية", "المتبقي"],
        [[s.get(k) for k in ("id", "baseLimit", "approvedException", "credited",
                            "contact", "remaining")] for s in plan.get("instructorLoads", [])])
    page(book, "العجز",
        ["الشعبة", "المقرر", "المستوى", "المتدربون", "الساعات الفعلية", "النصاب المكافئ", "السبب"],
        [[s.get(k) for k in ("sectionId", "courseCode", "level", "students",
                            "contactHours", "equivalentLoad", "reason")] for s in plan.get("gaps", [])])
    page(book, "ملاحظات",
        ["الملاحظة"], [[note] for note in plan.get("notices", [])])
    out = BytesIO()
    book.save(out)
    sys.stdout.buffer.write(out.getvalue())

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Excel export failed: {exc}", file=sys.stderr)
        sys.exit(2)
