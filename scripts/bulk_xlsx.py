#!/usr/bin/env python3
"""Read/write tightly bounded TPS resource XLSX templates. Never execute formulas/macros."""
import io
import json
import sys
import zipfile
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HEADERS = {
    "courses": ["code", "title", "level", "department", "theoryHours", "practicalHours", "demand", "proposedMode", "eligibleModes"],
    "instructors": ["code", "name", "department", "maxLoad", "eligibleCourseCodes", "allowedModes", "available"],
    "rooms": ["code", "name", "type", "capacity", "building", "available"],
    "blocks": ["cohortCode", "level", "code", "name", "size", "courseCodes"],
    "demand": ["courseCode", "level", "baseStudents", "repeatRate", "source", "confidence"],
}
NOTES = {
    "courses": [
        "الرمز والاسم والمستوى والقسم يجب أن يتطابقوا مع نطاق الاستيراد المختار.",
        "theoryHours, practicalHours: الساعات الأسبوعية. demand: الطلب المتوقع.",
        "proposedMode: ONSITE أو REMOTE أو SELF_PACED أو HYBRID.",
        "eligibleModes: الأهلية المقترحة بصيغة ONSITE|REMOTE. يجب تضمين ONSITE.",
        "الأهلية المقترحة لا تُمنح تلقائياً، وتتطلب اعتماداً مستقلاً قبل تفعيل أنماط غير حضورية."
    ],
    "instructors": [
        "code: رمز المدرب، name: الاسم، department: القسم، maxLoad: النصاب الأساسي",
        "eligibleCourseCodes: رموز المقررات مفصولة بعلامة |، فارغ = غير مقيد",
        "allowedModes: ONSITE|REMOTE|SELF_PACED|HYBRID حسب الأهلية",
        'available: JSON اختياري مثل [{"day":"SUN","from":8.5,"to":12}]',
        "لا يمكن استيراد استثناءات النصاب؛ لها مسار اعتماد مستقل."
    ],
    "rooms": [
        "code: رمز القاعة، name: الاسم، type: CLASSROOM أو LAB أو MULTI",
        "capacity: عدد المقاعد، building: المبنى اختياري",
        'available: JSON اختياري مثل [{"day":"SUN","from":8.5,"to":12}]',
        "القاعات مشتركة على مستوى الكلية؛ يتطلب الاستيراد صلاحيات كلية."
    ],
    "blocks": [
        "cohortCode: رمز الفوج المسجل سابقًا داخل القسم، level: المستوى 1–12",
        "code: رمز البلوك داخل الفوج، size: عدد المتدربين",
        "courseCodes: رموز المقررات المرتبطة بهذا البلوك في الفصل، مفصولة بعلامة |",
        "يجب تطابق مستوى كل مقرر مع مستوى الفوج، ولا تُحذف الروابط القديمة ضمنيًا."
    ],
    "demand": [
        "courseCode: رمز المقرر، level: المستوى للتأكد من صحة الربط",
        "baseStudents: العدد الأساسي، repeatRate: نسبة الإعادة مثل 0.05، فارغ = 0.05",
        "source: مصدر العدد، confidence: LOW أو MEDIUM أو HIGH (افتراضي MEDIUM)",
        "العدد المتوقع يحسب بالتقريب لأعلى؛ لا يتم استيراد أي بيانات شخصية."
    ],
}

def template(kind):
    wb = Workbook()
    ws = wb.active
    ws.title = "البيانات"
    ws.sheet_view.rightToLeft = True
    ws.append(HEADERS[kind])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:%s1" % get_column_letter(len(HEADERS[kind]))
    for index, header in enumerate(HEADERS[kind], 1):
        cell = ws.cell(1, index)
        cell.fill = PatternFill(fill_type="solid", fgColor="176B73")
        cell.font = Font(color="FFFFFF", bold=True)
        cell.alignment = Alignment(horizontal="center")
        ws.column_dimensions[get_column_letter(index)].width = 25 if index < 5 else 38
    ws.print_options.horizontalCentered = True
    tips = wb.create_sheet("إرشادات")
    tips.sheet_view.rightToLeft = True
    tips.column_dimensions["A"].width = 90
    tips.append(["إرشادات الاستيراد — جميع البيانات تخطيطية ومحلية"])
    tips["A1"].font = Font(bold=True, size=14)
    for line in NOTES[kind]:
        tips.append([line])
    out = io.BytesIO()
    wb.save(out)
    sys.stdout.buffer.write(out.getvalue())

def read(path, kind):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 1500 or sum(x.file_size for x in entries) > 20_000_000:
            raise ValueError("Excessive XLSX decompressed content")
        if any(x.filename.lower().endswith(("vbaproject.bin", ".exe", ".dll")) for x in entries):
            raise ValueError("Macros and executable entries are forbidden")
    wb = load_workbook(path, read_only=True, data_only=False)
    try:
        if "البيانات" not in wb.sheetnames:
            raise ValueError("Expected worksheet البيانات")
        ws = wb["البيانات"]
        if (ws.max_column or 0) > len(HEADERS[kind]) + 8 or (ws.max_row or 0) > 501:
            raise ValueError("Workbook exceeds 500 rows or expected columns")
        rows = []
        for row in ws.iter_rows(values_only=False):
            items = []
            for cell in row:
                if cell.data_type in ("f", "e"):
                    raise ValueError("Formula or spreadsheet error cells are not allowed")
                value = cell.value
                if isinstance(value, (str, int, float)) or value is None:
                    items.append("" if value is None else str(value))
                else:
                    raise ValueError("Unsupported cell type")
            rows.append(items)
        if not rows:
            raise ValueError("Empty workbook")
        sys.stdout.write(json.dumps({"rows": rows}, ensure_ascii=False))
    finally:
        wb.close()

if __name__ == "__main__":
    try:
        action = sys.argv[1]
        kind = sys.argv[2]
        if kind not in HEADERS:
            raise ValueError("Unsupported import template")
        if action == "template":
            template(kind)
        elif action == "read" and len(sys.argv) == 4:
            read(sys.argv[3], kind)
        else:
            raise ValueError("Unknown bulk XLSX command")
    except Exception as exc:
        print("Bulk XLSX failed: " + str(exc)[:250], file=sys.stderr)
        sys.exit(2)
