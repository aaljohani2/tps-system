import io
import json
import subprocess
import sys
import unittest
from pathlib import Path
from openpyxl import load_workbook
from pypdf import PdfReader

class ScheduleReportTest(unittest.TestCase):
    def test_general_source_keeps_provenance_and_allows_readable_multi_page_native_printing(self):
        payload = self.payload()
        meeting = payload['entities'][0]['meetings'][0]
        meeting['sourceRef'] = 'الإدارة!B4'
        meeting['timingStatus'] = 'مبدئي؛ ربط تخطيطي مفترض'
        book = load_workbook(io.BytesIO(self.render(payload, 'xlsx')))
        self.assertEqual(book['المحاضرات']['N1'].value, 'مرجع المصدر')
        self.assertEqual(book['المحاضرات']['N2'].value, 'الإدارة!B4')
        self.assertEqual(book['المحاضرات']['O2'].value, meeting['timingStatus'])
        self.assertEqual(book['قاعة 001'].page_setup.fitToHeight, 0)
        self.assertEqual(book['المحاضرات'].page_setup.paperSize, 8)
        book.close()
        pdf = PdfReader(io.BytesIO(self.render(payload, 'pdf')))
        self.assertIn('B4', ''.join(page.extract_text(extraction_mode='layout') for page in pdf.pages))

    def payload(self):
        meeting = {"id": "M", "courseCode": "C-101", "title": "مقرر اختبار", "sectionId": "C-101-001", "sectionNumber": 1,
                   "level": 1, "students": 20, "component": "نظري", "day": "SUN", "startMinute": 480, "endMinute": 580,
                   "trainingHours": 2, "clockMinutes": 100, "instructor": "مدرب الاختبار (1)", "room": "قاعة الاختبار (001)", "roomCode": "001", "warning": False}
        return {"version": 1, "kind": "rooms", "title": "جداول القاعات", "metadata": {"scenarioId": "S", "scenarioName": "سيناريو اصطناعي",
                "state": "DRAFT", "solverStatus": "COMPLETED", "revision": 1, "policyRevision": 2, "collegeName": "كلية اختبار",
                "departmentName": "قسم اختبار", "termCode": "T", "generatedAt": "2026-11-08 12:00"}, "notes": [],
                "summary": {"departmentSections": 1, "scheduledSections": 1, "gaps": 0, "externalSections": 0, "studentCount": None},
                "entities": [{"id": "001", "title": "قاعة الاختبار (001)", "notes": [], "meetings": [meeting], "pending": [],
                              "sectionCount": 1, "trainingHours": 2, "clockMinutes": 100}], "pending": [], "issues": []}

    def render(self, payload, fmt):
        process = subprocess.run([sys.executable, str(Path(__file__).with_name('export_schedule_report.py')), '--format', fmt],
                                 input=json.dumps(payload,ensure_ascii=False).encode('utf-8'), capture_output=True, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr.decode())
        return process.stdout

    def test_excel_is_rtl_preserves_zero_prefixes_and_numeric_clock_values(self):
        book = load_workbook(io.BytesIO(self.render(self.payload(), 'xlsx')))
        self.assertTrue(all(sheet.sheet_view.rightToLeft for sheet in book))
        self.assertEqual(book['الملخص']['A10'].value, '001')
        self.assertEqual(book['الملخص']['B10'].value, 'قاعة الاختبار (001)')
        self.assertAlmostEqual(book['المحاضرات']['E2'].value.hour + book['المحاضرات']['E2'].value.minute/60, 9+40/60)
        self.assertEqual(book['المحاضرات']['M2'].value, 100)
        self.assertEqual(book['قاعة 001']['F5'].value.total_seconds(), 6000)
        book.close()

    def test_pdf_is_a_real_landscape_document_with_overview_and_entity_page(self):
        data = self.render(self.payload(), 'pdf')
        self.assertEqual(data[:4], b'%PDF')
        pdf = PdfReader(io.BytesIO(data))
        self.assertEqual(len(pdf.pages), 2)
        self.assertGreater(pdf.pages[0].mediabox.width, pdf.pages[0].mediabox.height)
        self.assertIn('09:40', pdf.pages[1].extract_text())

    def test_excel_does_not_turn_report_titles_into_executable_formulas(self):
        payload = self.payload()
        payload['entities'][0]['title'] = '=HYPERLINK("https://example.invalid")'
        book = load_workbook(io.BytesIO(self.render(payload, 'xlsx')))
        for sheet in book:
            for row in sheet:
                self.assertTrue(all(cell.data_type != 'f' for cell in row))
        book.close()
