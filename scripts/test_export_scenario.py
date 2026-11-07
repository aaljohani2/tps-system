import io
import json
import subprocess
import sys
import unittest
from pathlib import Path
from openpyxl import load_workbook

class ExportScenarioTest(unittest.TestCase):
    def test_external_courses_have_their_own_roster_without_entering_department_sections(self):
        payload = {"sections": [], "sessions": [], "gaps": [], "instructorLoads": [], "notices": [],
                   "externalSections": [{"id": "G-EXT-001", "courseCode": "GENERAL", "title": "لغة عامة",
                                         "level": 1, "students": 40, "capacity": 40, "contactHours": 3}]}
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("export_scenario.py"))],
                                input=json.dumps(payload).encode(), capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        book = load_workbook(io.BytesIO(result.stdout))
        self.assertIn("المقررات العامة الخارجية", book.sheetnames)
        self.assertEqual(book["المقررات العامة الخارجية"]["F2"].value, 40)
        self.assertEqual(book["المقررات العامة الخارجية"]["I2"].value, "بانتظار إسناد القسم الآخر")
        self.assertEqual(book["الشعب"].max_row, 1)
        self.assertEqual(book["العجز"].max_row, 1)
        book.close()

    def test_writes_arabic_rtl_xlsx_without_active_formula(self):
        payload = {
            "sections": [{"id": "SEC-1", "courseCode": "=1+1", "level": 1, "students": 12}],
            "sessions": [{"courseCode": "=1+1", "sectionId": "SEC-1", "day": "SUN",
                          "start": 8, "end": 10, "roomId": "R1", "mode": "ONSITE",
                          "instructorId": "I1", "blockId": "B1"}],
            "gaps": [], "instructorLoads": [], "notices": ["Synthetic data only"]
        }
        script = Path(__file__).with_name("export_scenario.py")
        process = subprocess.run([sys.executable, str(script)], input=json.dumps(payload).encode(),
                                 capture_output=True, timeout=20)
        self.assertEqual(process.returncode, 0, process.stderr.decode())
        self.assertEqual(process.stdout[:2], b"PK")
        wb = load_workbook(io.BytesIO(process.stdout), read_only=False, data_only=False)
        self.assertEqual(wb.sheetnames, ["الجداول", "الشعب", "الأنصبة", "العجز",
            "جداول المدربين", "جداول القاعات", "جداول المستويات",
            "جداول البلوكات", "التعارضات", "ملاحظات"])
        self.assertTrue(wb["الجداول"].sheet_view.rightToLeft)
        self.assertTrue(wb["الجداول"]["A2"].value.startswith("'="))
        self.assertNotEqual(wb["الجداول"]["A2"].data_type, "f")

    def test_evidenced_conflicts_and_comparison_are_exported_from_payload(self):
        payload = {"plan": {
            "sections":[{"id":"SEC1","courseCode":"T-100","level":2,"students":20}],
            "sessions":[{"id":"M-1","courseCode":"T-100","sectionId":"SEC1",
                "component":"THEORY","day":"SUN","start":8.5,"end":10.5,
                "roomId":"R1","mode":"ONSITE","instructorId":"I1","blockId":"G::B"}],
            "gaps":[],"instructorLoads":[],"notices":[]
          },"metadata":{
            "state":"NOT_APPROVED","scenarioName":"Synthetic scenario","termId":"TERM",
            "policyRevision":1,
            "readiness":{"technicalReady":False,"issues":[{"code":"TIMETABLE_COLLISION",
                "severity":"BLOCKER","message":"Synthetic collision","sectionId":"SEC1","courseCode":"T-100"}]},
            "comparisonRows":[["السيناريو","First","Second"],["الشعب",1,2]]
          }}
        result = subprocess.run([sys.executable,str(Path(__file__).with_name("export_scenario.py"))],
            input=json.dumps(payload,ensure_ascii=False).encode(),capture_output=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        wb=load_workbook(io.BytesIO(result.stdout))
        self.assertIn("التعارضات",wb.sheetnames)
        self.assertIn("جداول المدربين",wb.sheetnames)
        self.assertIn("مقارنة السيناريوهات",wb.sheetnames)
        self.assertEqual(wb["التعارضات"]["A2"].value,"TIMETABLE_COLLISION")
        self.assertEqual(wb["جداول المدربين"]["G2"].value,"08:30")
        self.assertEqual(wb["مقارنة السيناريوهات"]["C3"].value,2)
        self.assertTrue(all(ws.sheet_view.rightToLeft for ws in wb.worksheets))
        wb.close()
