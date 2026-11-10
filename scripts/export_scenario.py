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
    section_by_id = {section.get("id"): section for section in plan.get("sections", [])}
    days = {"SUN": 1, "MON": 2, "TUE": 3, "WED": 4, "THU": 5}
    def ordered(items, key):
        return sorted(items, key=lambda item: (
            str(item.get(key) or ""),
            days.get(item.get("day"), 99),
            float(item.get("start") or 0),
            str(item.get("sectionId") or "")))
    def clock(hours):
        if not isinstance(hours, (int, float)):
            return ""
        return f"{int(hours):02d}:{'30' if round((hours % 1) * 2) == 1 else '00'}"
    page(book, "جداول المدربين",
        ["المدرب", "المقرر", "الشعبة", "المكون", "النمط", "اليوم", "من", "إلى", "القاعة", "البلوك"],
        [[s.get("instructorId"),s.get("courseCode"),s.get("sectionId"),s.get("component"),
          s.get("mode"),s.get("day"),clock(s.get("start")),clock(s.get("end")),
          s.get("roomId"),s.get("blockId")] for s in ordered(sessions, "instructorId")])
    onsite = [s for s in sessions if s.get("mode")=="ONSITE" and s.get("roomId")]
    page(book, "جداول القاعات",
        ["القاعة", "المقرر", "الشعبة", "المدرب", "المكون", "اليوم", "من", "إلى", "البلوك"],
        [[s.get("roomId"),s.get("courseCode"),s.get("sectionId"),s.get("instructorId"),
          s.get("component"),s.get("day"),clock(s.get("start")),clock(s.get("end")),
          s.get("blockId")] for s in ordered(onsite, "roomId")])
    level_sessions = sorted(sessions, key=lambda s:(
        int(section_by_id.get(s.get("sectionId"),{}).get("level") or 0),
        days.get(s.get("day"),99),float(s.get("start") or 0)))
    page(book, "جداول المستويات",
        ["المستوى", "المقرر", "الشعبة", "المدرب", "القاعة", "اليوم", "من", "إلى", "البلوك"],
        [[section_by_id.get(s.get("sectionId"),{}).get("level"),s.get("courseCode"),
          s.get("sectionId"),s.get("instructorId"),s.get("roomId"),
          s.get("day"),clock(s.get("start")),clock(s.get("end")),s.get("blockId")]
         for s in level_sessions])
    blocks = [s for s in sessions if s.get("blockId")]
    page(book, "جداول البلوكات",
        ["البلوك", "المقرر", "الشعبة", "المستوى", "المدرب", "القاعة", "اليوم", "من", "إلى"],
        [[s.get("blockId"),s.get("courseCode"),s.get("sectionId"),
          section_by_id.get(s.get("sectionId"),{}).get("level"),
          s.get("instructorId"),s.get("roomId"),s.get("day"),
          clock(s.get("start")),clock(s.get("end"))]
         for s in ordered(blocks, "blockId")])
    readiness = (metadata or {}).get("readiness") or {}
    issues = readiness.get("issues") or []
    page(book, "التعارضات",
        ["الرمز", "الخطورة", "التفسير", "الشعبة", "المقرر"],
        [[i.get("code"),i.get("severity"),i.get("message"),i.get("sectionId"),
          i.get("courseCode")] for i in issues])
    if metadata and metadata.get("comparisonRows"):
        page(book, "مقارنة السيناريوهات",
            ["المؤشر", "السيناريو الأول", "السيناريو الثاني"],
            metadata["comparisonRows"])
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
