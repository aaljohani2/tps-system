import io
import json
import subprocess
import sys
import unittest
from pathlib import Path
from openpyxl import load_workbook

class ExportScenarioTest(unittest.TestCase):
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
        self.assertEqual(wb.sheetnames, ["الجداول", "الشعب", "الأنصبة", "العجز", "ملاحظات"])
        self.assertTrue(wb["الجداول"].sheet_view.rightToLeft)
        self.assertTrue(wb["الجداول"]["A2"].value.startswith("'="))
        self.assertNotEqual(wb["الجداول"]["A2"].data_type, "f")
