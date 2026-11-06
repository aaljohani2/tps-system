import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from openpyxl import load_workbook

SCRIPT = Path(__file__).resolve().parent / "bulk_xlsx.py"

def invoke(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str,args)], capture_output=True, timeout=25)

class BulkXlsxTests(unittest.TestCase):
    def test_template_headers_and_rtl(self):
        for kind,headers in {
            "instructors":["code","name","maxLoad","eligibleCourseCodes","allowedModes","available"],
            "rooms":["code","name","type","capacity","building","available"],
            "blocks":["cohortCode","code","name","size","courseCodes"],
            "demand":["courseCode","level","baseStudents","repeatRate","source","confidence"]
        }.items():
            with self.subTest(kind=kind):
                response=invoke("template",kind)
                self.assertEqual(response.returncode,0,response.stderr.decode())
                self.assertTrue(response.stdout.startswith(b"PK"))
                wb=load_workbook(io.BytesIO(response.stdout))
                self.assertEqual(list(next(wb["البيانات"].values)),headers)
                self.assertTrue(wb["البيانات"].sheet_view.rightToLeft)
                self.assertIn("إرشادات",wb.sheetnames)
                wb.close()

    def test_read_valid_and_block_formula_execution(self):
        response=invoke("template","rooms")
        self.assertEqual(response.returncode,0)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"rows.xlsx"
            wb=load_workbook(io.BytesIO(response.stdout))
            ws=wb["البيانات"]
            ws.append(["T-ROOM","قاعة اصطناعية","CLASSROOM",30,"A1",""])
            wb.save(path);wb.close()
            read=invoke("read","rooms",path)
            self.assertEqual(read.returncode,0,read.stderr.decode())
            parsed=json.loads(read.stdout)
            self.assertEqual(parsed["rows"][1][:4],
                ["T-ROOM","قاعة اصطناعية","CLASSROOM","30"])
            bad=load_workbook(path)
            bad["البيانات"]["B2"]="=HYPERLINK(\"http://example.org\")"
            bad.save(path);bad.close()
            blocked=invoke("read","rooms",path)
            self.assertNotEqual(blocked.returncode,0)
            self.assertIn(b"Formula",blocked.stderr)

if __name__=="__main__":
    unittest.main()
