import datetime as dt
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook, load_workbook
from read_general_courses import clock, norm, parse_workbook


class GeneralCourseSourceTest(unittest.TestCase):
    def fixture(self, target):
        book = Workbook()
        s = book.active
        s.title = 'الإدارة'
        s['A2'] = 'المستوى الثاني - شعبة 1'
        s['G2'] = 'المحاضرات المسائية'
        for col, value in zip('BCDEF', ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس']):
            s[col+'3'] = value
        s['A4'], s['A5'] = dt.time(8), dt.time(9, 40)
        s['B4'] = 'انجليزي2\n50365'
        s.merge_cells('B4:B5')
        s['A6'], s['A7'] = dt.time(10), dt.time(11, 40)
        s['E6'], s['E7'] = 'ريادة أعمال', 'ذاتي'
        s['A8'], s['A9'] = dt.time(12), dt.time(1, 40)
        s['C8'] = 'إحصاء'
        s.merge_cells('C8:C9')
        s['G4'], s['H4'], s['I4'] = 'انجليزي', 'الأحد', dt.time(16)
        s['G5'] = 'إلغاء'
        s['G6'] = 'رياضيات'
        s['G3'], s['H3'], s['I3'] = 'المقرر', 'اليوم', 'الوقت'
        extra = book.create_sheet('الحاسب')
        extra['A1'] = 'بيانات تخصص آخر'
        book.save(target)
        book.close()

    def test_clock_never_guesses_meridiem(self):
        self.assertEqual(clock(dt.time(1, 40)), 100)
        self.assertEqual(clock('12:00'), 720)
        self.assertEqual(clock('22:00'), 1320)
        self.assertIsNone(clock('25:00'))
        self.assertIsNone(clock('04:00 مساء'))

    def test_matrix_merge_markers_and_incomplete_evening_keep_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'source.xlsx'
            self.fixture(path)
            before = path.read_bytes()
            raw, items, issues = parse_workbook(path)
            self.assertEqual(before, path.read_bytes())
            self.assertEqual(len(raw['sheets']), 2)
            english = next(i for i in items if i['id']=='الإدارة!B4')
            self.assertEqual(english['startMinute'], 480)
            self.assertEqual(english['endMinute'], 580)
            self.assertEqual(english['identifiersUnverified'], ['50365'])
            self.assertIn('A5', english['sourceCells'])
            self.assertEqual(next(i for i in items if i['id']=='الإدارة!E6')['kind'], 'SELF_PACED')
            self.assertEqual(next(i for i in items if i['id']=='الإدارة!G5')['kind'], 'CANCELLED')
            noon = next(i for i in items if i['id']=='الإدارة!C8')
            self.assertEqual(noon['literalEndMinute'], 100)
            self.assertIsNone(noon['endMinute'])
            evening = next(i for i in items if i['id']=='الإدارة!G4')
            self.assertEqual(evening['literalStartMinute'], 960)
            self.assertIsNone(evening['endMinute'])
            self.assertTrue(any(i['code']=='INCOMPLETE_EVENING' for i in issues))
            self.assertEqual(sum(i['rawTitle']=='انجليزي2\n50365' for i in items), 1)

    def test_reference_hash_mismatch_fails_without_changing_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'source.xlsx'
            self.fixture(path)
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                parse_workbook(path, {'original_workbook_sha256':'0'*64})

    def test_right_group_uses_documented_shared_band_not_a_new_time(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'source.xlsx'
            self.fixture(path)
            book = load_workbook(path)
            s = book['الإدارة']
            s['J2'] = 'المستوى الثاني - شعبة 2'
            s['K4'] = 'انجليزي 2'
            s.merge_cells('K4:K5')
            book.save(path)
            book.close()
            _, items, _ = parse_workbook(path)
            item = next(i for i in items if i['id']=='الإدارة!K4')
            self.assertEqual(item['sourceGroupNumber'], 2)
            self.assertEqual(item['day'], 'SUN')
            self.assertEqual(item['endMinute'], 580)
            self.assertTrue({'J2','B3','A4','A5'}.issubset(item['sourceCells']))


if __name__ == '__main__':
    unittest.main()
