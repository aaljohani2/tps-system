import unittest
import tempfile
from pathlib import Path
from openpyxl import Workbook
from import_xlsx import parse

class XlsxImportTest(unittest.TestCase):
    def test_safe_course_only_import(self):
        w=Workbook();s=w.active;s.title='المقررات'
        s.append(['رمز المقرر','اسم المقرر','المستوى','الطلب المتوقع','نظري + تمارين','عملي','طريقة التدريب'])
        s.append(['ادار-101','مبادئ الإدارة',1,126,4,0,'عن بُعد'])
        s.append(['ادار-299','التدريب التعاوني',5,56,0,0,'حضوري'])
        s.append(['ادار-288','المشروع',4,30,2,0,'حضوري'])
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'source.xlsx';w.save(p)
            c=parse(p)
        self.assertEqual(len(c['courses']),1)
        self.assertEqual(c['courses'][0]['demand'],126)
        self.assertEqual(c['courses'][0]['mode'],'ONSITE')
        self.assertEqual(len(c['ignored']),2)
    def test_unsupported_header_rejected(self):
        w=Workbook();w.active['A1']='n/a'
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'source.xlsx';w.save(p)
            with self.assertRaisesRegex(ValueError,'No supported course catalog'):
                parse(p)

if __name__ == '__main__': unittest.main()
