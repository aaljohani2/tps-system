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

class XlsxSecurityTest(unittest.TestCase):
    def test_formula_value_not_trusted(self):
        w=Workbook();s=w.active;s.title='المقررات'
        s.append(['رمز المقرر','اسم المقرر','المستوى','الطلب المتوقع','نظري + تمارين','عملي'])
        s.append(['ادار-101','مقرر',1,'=2+2',3,0])
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'formula.xlsx';w.save(p)
            with self.assertRaisesRegex(ValueError,'must be a nonnegative integer'):
                parse(p)
    def test_formula_like_course_identity_not_allowed(self):
        w=Workbook();s=w.active;s.title='المقررات'
        s.append(['رمز المقرر','اسم المقرر','المستوى','الطلب المتوقع','نظري + تمارين','عملي'])
        s.append(["=HYPERLINK('https://example.invalid')",'مقرر',1,0,3,0])
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'identity.xlsx';w.save(p)
            with self.assertRaisesRegex(ValueError,'formula-like'):
                parse(p)
    def test_demand_imports_exact_integer(self):
        w=Workbook();s=w.active;s.title='المقررات'
        s.append(['رمز المقرر','اسم المقرر','المستوى','الطلب المتوقع','نظري + تمارين','عملي'])
        s.append(['ادار-101','مقرر',1,137,2,2])
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'filled.xlsx';w.save(p)
            result=parse(p)
            self.assertEqual(result['courses'][0]['demand'], 137)
            self.assertEqual(result['courses'][0]['mode'], 'ONSITE')
