#!/usr/bin/env python3
"""Render a saved TPS report DTO locally; no scheduling or external requests."""
import argparse
import io
import json
import os
import re
import sys
from functools import lru_cache
from pathlib import Path

DAYS = [('SUN', 'الأحد'), ('MON', 'الاثنين'), ('TUE', 'الثلاثاء'), ('WED', 'الأربعاء'), ('THU', 'الخميس')]
NAVY = '24384B'
BLUE = 'EAF2FA'
GREEN = 'E9F3EC'
AMBER = 'FFF2CF'
RED = 'FCE9E8'

def clock(minute):
    value = round(minute)
    return f'{value // 60:02d}:{value % 60:02d}'

def safe(value):
    if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')):
        return "'" + value
    return value

def status(report):
    state = {'DRAFT': 'مسودة تخطيطية', 'APPROVED': 'معتمد داخليًا', 'UNDER_REVIEW': 'تحت المراجعة'}.get(report['metadata']['state'], report['metadata']['state'])
    solver = 'حل Timefold مكتمل' if report['metadata']['solverStatus'] == 'COMPLETED' else 'معاينة لم يكتمل تحسينها'
    return f'{state}، {solver}'

def starts(entity):
    return sorted({480, 600, 720} | {m['startMinute'] for m in entity['meetings']})

def cell_lines(meetings, kind):
    lines = []
    for meeting in meetings:
        if lines:
            lines.append('')
        lines += [meeting['title'], f"{meeting['courseCode']}، {meeting['component']}، شعبة {meeting['sectionNumber']}",
                  f"{clock(meeting['startMinute'])} - {clock(meeting['endMinute'])}"]
        if kind != 'instructors':
            lines.append('المدرب: ' + meeting['instructor'])
        if kind != 'rooms':
            lines.append('القاعة: ' + meeting['roomCode'])
        if meeting['warning']:
            lines.append('تنبيه تداخل اقتصاد مسموح')
    return lines

def export_xlsx(report):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.pagebreak import Break
    from openpyxl.workbook.properties import CalcProperties
    book = Workbook()
    overview = book.active
    overview.title = 'الملخص'
    book.calculation = CalcProperties(fullCalcOnLoad=True)
    base_font = Font(name='Arial', size=10, color='24384B')

    def setup(sheet, widths):
        sheet.sheet_view.rightToLeft = True
        sheet.sheet_view.showGridLines = False
        sheet.sheet_properties.pageSetUpPr.fitToPage = True
        sheet.page_setup.orientation = 'landscape'
        sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
        sheet.page_setup.fitToWidth = 1
        sheet.page_setup.fitToHeight = 0
        sheet.page_margins.left = sheet.page_margins.right = 0.25
        sheet.page_margins.top = sheet.page_margins.bottom = 0.35
        sheet.oddFooter.center.text = 'صفحة &P من &N'
        sheet.oddFooter.right.text = status(report)
        for index, width in enumerate(widths, 1):
            sheet.column_dimensions[get_column_letter(index)].width = width

    def write(sheet, row, values, fill=None, bold=False, height=22):
        for col, value in enumerate(values, 1):
            cell = sheet.cell(row, col, safe(value))
            cell.font = Font(name='Arial', size=10, bold=bold, color='FFFFFF' if fill == NAVY else '24384B')
            cell.alignment = Alignment(horizontal='right' if isinstance(value, str) else 'center', vertical='center', wrap_text=True)
            if fill:
                cell.fill = PatternFill('solid', fgColor=fill)
        sheet.row_dimensions[row].height = height

    def heading(sheet, text, subtitle):
        sheet.merge_cells('A2:F2')
        sheet['A2'] = safe(text)
        sheet['A2'].font = Font(name='Arial', size=15, bold=True, color=NAVY)
        sheet['A2'].alignment = Alignment(horizontal='right', vertical='center')
        sheet.row_dimensions[2].height = 28
        sheet.merge_cells('A3:F3')
        sheet['A3'] = safe(subtitle)
        sheet['A3'].font = base_font
        sheet['A3'].alignment = Alignment(horizontal='right', wrap_text=True, vertical='center')
        sheet.row_dimensions[3].height = 32
        sheet.merge_cells('A4:F4')
        sheet['A4'] = safe(status(report) + '، ' + report['metadata']['departmentName'] + '، مرجع الفصل ' + report['metadata']['termCode'])
        sheet['A4'].font = base_font
        sheet['A4'].alignment = Alignment(horizontal='right', vertical='center', wrap_text=True)
        sheet.row_dimensions[4].height = 25

    setup(overview, [21, 43, 15, 20, 21, 18])
    heading(overview, report['title'], report['metadata']['scenarioName'])
    summary = report['summary']
    write(overview, 6, ['شعب القسم', summary['departmentSections'], 'المجدول', summary['scheduledSections'], 'غير المغطى', summary['gaps']])
    write(overview, 7, ['شعب عامة خارجية', summary['externalSections'], 'خارج نصاب القسم', None, 'المتدربون', summary['studentCount']])
    write(overview, 9, ['الرمز', 'المدرب أو المجموعة أو القاعة', 'الشعب المجدولة', 'ساعات تدريبية', 'الوقت الفعلي', 'عدد المتدربين'], NAVY, True, 28)
    overview.freeze_panes = 'C10'
    overview.print_title_rows = '1:9'
    used_names = {'الملخص'}
    for index, entity in enumerate(report['entities'], 10):
        name = re.sub(r'[\[\]:*?/\\]', '_', entity['id'])[:25]
        prefix = {'instructors': 'مدرب ', 'rooms': 'قاعة ', 'trainees': 'مجموعة '}[report['kind']]
        name = (prefix + name)[:31]
        suffix = 1
        candidate = name
        while candidate in used_names:
            suffix += 1
            candidate = name[:27] + f' {suffix}'
        used_names.add(candidate)
        sheet = book.create_sheet(candidate)
        setup(sheet, [14, 27, 27, 27, 27, 27])
        heading(sheet, entity['title'], report['metadata']['scenarioName'])
        write(sheet, 5, ['الشعب المجدولة', entity['sectionCount'], 'الساعات التدريبية', entity['trainingHours'], 'الوقت الفعلي', entity['clockMinutes'] / 1440])
        sheet['F5'].number_format = '[h]:mm'
        if entity.get('students') is not None:
            write(sheet, 6, ['عدد المتدربين', entity['students']])
        write(sheet, 8, ['بداية اللقاء'] + [label for _, label in DAYS], NAVY, True, 24)
        row = 9
        for start in starts(entity):
            values = [start / 1440]
            cells = []
            for day, _ in DAYS:
                meetings = [m for m in entity['meetings'] if m['day'] == day and m['startMinute'] == start]
                cells.append(meetings)
                values.append('\n'.join(cell_lines(meetings, report['kind'])))
            write(sheet, row, values, height=76)
            sheet.cell(row, 1).number_format = 'hh:mm'
            for col, meetings in enumerate(cells, 2):
                if meetings:
                    sheet.cell(row, col).fill = PatternFill('solid', fgColor=AMBER if any(m['warning'] for m in meetings) else GREEN if all(m['component'] == 'عملي' for m in meetings) else BLUE)
                sheet.cell(row, col).font = Font(name='Arial', size=9, color=NAVY)
                sheet.cell(row, col).alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
                sheet.cell(row, col).border = Border(bottom=Side(style='hair', color='D8E0E7'))
            row += 1
        notes = list(entity['notes'])
        if not entity['meetings']:
            notes.append('لا توجد محاضرات أسبوعية مسندة لهذه الجهة في اللقطة الحالية.')
        for note in notes:
            row += 1
            sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=6)
            sheet.cell(row, 1, safe(note)).alignment = Alignment(horizontal='right', wrap_text=True, vertical='center')
            sheet.cell(row, 1).font = base_font
            sheet.row_dimensions[row].height = 28
        if entity['pending']:
            row += 2
            write(sheet, row, ['المقرر', 'اسم المقرر', 'الشعبة التخطيطية', 'المستوى', 'طلاب الشعبة', 'الحالة'], NAVY, True, 28)
            for item in entity['pending']:
                row += 1
                write(sheet, row, [item['courseCode'], item['title'], item['sectionId'], item['level'], item['students'], item['status']],
                      AMBER if item['status'].startswith('بانتظار') else RED, height=30)
        sheet.freeze_panes = 'B9'
        sheet.print_area = f'A1:F{row}'
        sheet.page_setup.fitToHeight = 1
        write(overview, index, [entity['id'], entity['title'], entity['sectionCount'], entity['trainingHours'], entity['clockMinutes'] / 1440, entity.get('students')],
              'F2F5F8' if index % 2 == 0 else None)
        overview.cell(index, 5).number_format = '[h]:mm'
        overview.cell(index, 2).hyperlink = f"#'{candidate.replace(chr(39), chr(39)*2)}'!A2"
        overview.cell(index, 2).font = Font(name='Arial', size=10, color='1E5C99', underline='single')
    row = 12 + len(report['entities'])
    for note in report['notes'] + [f"مصدر البيانات: السيناريو المحفوظ في TPS، مراجعة {report['metadata']['revision']}، إصدار السياسة {report['metadata']['policyRevision']}."]:
        overview.merge_cells(start_row=row, start_column=1, end_row=row, end_column=6)
        overview.cell(row, 1, safe(note)).alignment = Alignment(horizontal='right', vertical='center', wrap_text=True)
        overview.cell(row, 1).font = base_font
        overview.row_dimensions[row].height = 30
        row += 1
    overview.print_area = f'A1:F{row}'
    detail = book.create_sheet('المحاضرات')
    setup(detail, [10, 20, 10, 9, 9, 14, 25, 10, 18, 18, 22, 12, 12])
    write(detail, 1, ['الجهة', 'الاسم', 'اليوم', 'من', 'إلى', 'المقرر', 'اسم المقرر', 'المكون', 'الشعبة التخطيطية', 'المدرب', 'القاعة', 'ساعات تدريبية', 'دقائق فعلية'], NAVY, True, 34)
    row = 2
    for entity in report['entities']:
        for meeting in entity['meetings']:
            write(detail, row, [entity['id'], entity['title'], dict(DAYS).get(meeting['day'], meeting['day']), meeting['startMinute']/1440,
                  meeting['endMinute']/1440, meeting['courseCode'], meeting['title'], meeting['component'], meeting['sectionId'],
                  meeting['instructor'], meeting['room'], meeting['trainingHours'], meeting['clockMinutes']], height=42)
            detail.cell(row, 4).number_format = detail.cell(row, 5).number_format = 'hh:mm'
            row += 1
    detail.auto_filter.ref = detail.dimensions
    detail.freeze_panes = 'C2'
    detail.print_title_rows = '1:1'
    pending = book.create_sheet('الشعب غير المجدولة')
    setup(pending, [21, 42, 27, 14, 16, 20, 39])
    write(pending, 1, ['المقرر', 'اسم المقرر', 'الشعبة التخطيطية', 'المستوى', 'طلاب الشعبة', 'ساعات تدريبية', 'الحالة'], NAVY, True, 28)
    for row, item in enumerate(report['pending'], 2):
        write(pending, row, [item['courseCode'], item['title'], item['sectionId'], item['level'], item['students'], item['trainingHours'], item['status']],
              AMBER if item['status'].startswith('بانتظار') else RED, height=27)
    pending.auto_filter.ref = pending.dimensions
    pending.freeze_panes = 'C2'
    pending.print_title_rows = '1:1'
    if report['issues']:
        issues = book.create_sheet('ملاحظات الجدولة')
        setup(issues, [30, 18, 105])
        write(issues, 1, ['نوع الملاحظة', 'الخطورة', 'التفاصيل'], NAVY, True)
        for row, issue in enumerate(report['issues'], 2):
            write(issues, row, [issue['code'], issue['severity'], issue['message']], height=34)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()

def export_pdf(report):
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    import arabic_reshaper
    from bidi.algorithm import get_display
    font_dir = Path(os.environ.get('TPS_REPORT_FONT_DIR', 'C:/Windows/Fonts'))
    regular = font_dir / 'arial.ttf'
    bold = font_dir / 'arialbd.ttf'
    # Keep Windows Arial as the normal production font. On Linux runners use
    # installed DejaVu Arabic glyphs without shipping font files in the repo.
    if not os.environ.get('TPS_REPORT_FONT_DIR') and (not regular.is_file() or not bold.is_file()):
        linux_fonts = Path('/usr/share/fonts/truetype/dejavu')
        regular = linux_fonts / 'DejaVuSans.ttf'
        bold = linux_fonts / 'DejaVuSans-Bold.ttf'
    if not regular.is_file() or not bold.is_file():
        raise ValueError('Arabic report fonts missing; configure TPS_REPORT_FONT_DIR with arial.ttf and arialbd.ttf')
    pdfmetrics.registerFont(TTFont('TPS', str(regular)))
    pdfmetrics.registerFont(TTFont('TPS-Bold', str(bold)))
    out = io.BytesIO()
    width, height = landscape(A4)
    c = canvas.Canvas(out, pagesize=(width, height), pageCompression=1)
    c.setTitle(report['title'] + ' - ' + report['metadata']['scenarioName'])
    c.setAuthor('TPS')
    margin = 30
    usable = width - margin*2
    page = 0
    @lru_cache(maxsize=16384)
    def shaped(value):
        return get_display(arabic_reshaper.reshape(str(value)))
    def wrap(value, span, font='TPS', size=9):
        result = []
        for paragraph in str(value).split('\n'):
            line = ''
            for word in paragraph.split():
                candidate = (line + ' ' + word).strip()
                if line and pdfmetrics.stringWidth(shaped(candidate), font, size) > span:
                    result.append(line)
                    line = word
                else:
                    line = candidate
            result.append(line)
        return result
    def text(value, right, y, span, size=9, bold=False, center=False, color=NAVY):
        font = 'TPS-Bold' if bold else 'TPS'
        c.setFont(font, size)
        c.setFillColor('#'+color)
        for line in wrap(value, span, font, size):
            if center:
                c.drawCentredString(right-span/2, y, shaped(line))
            else:
                c.drawRightString(right, y, shaped(line))
            y -= size + 3
        return y
    def new_page(label):
        nonlocal page
        if page:
            c.showPage()
        page += 1
        text(report['title'], width-margin, height-30, usable, 16, True)
        y = text(report['metadata']['scenarioName'], width-margin, height-49, usable, 9)
        y = text(label, width-margin, y-9, usable, 12, True)
        y = text(report['metadata']['collegeName'] + '، ' + report['metadata']['departmentName'] + '، مرجع الفصل ' + report['metadata']['termCode'] + '، ' + status(report), width-margin, y-6, usable, 8)
        c.setStrokeColor('#CAD3DD')
        c.line(margin, y, width-margin, y)
        text('صفحة '+str(page), width-margin, 17, 150, 8)
        text('TPS  '+report['metadata']['generatedAt'], margin+260, 17, 260, 8)
        return y-16
    def table(y, headers, rows, spans, label, fills=None, size=8.5):
        def draw(row, y, fill=None, header=False):
            row = list(reversed(row)); widths = list(reversed(spans))
            line_counts = [len(wrap(value, span-12, 'TPS-Bold' if header else 'TPS', size)) for value, span in zip(row,widths)]
            row_height = max(18, max(line_counts, default=1)*(size+3)+6)
            x = margin
            for index, (value, span) in enumerate(zip(row,widths)):
                cell_fill = fill[index] if isinstance(fill, list) else fill
                if cell_fill:
                    c.setFillColor('#'+cell_fill); c.rect(x,y-row_height,span,row_height,stroke=0,fill=1)
                c.setStrokeColor('#D9E0E7');c.line(x,y-row_height,x+span,y-row_height)
                text(value,x+span-6,y-12,span-12,size,header,True,'FFFFFF' if header else NAVY)
                x += span
            return y-row_height
        y = draw(headers,y,NAVY,True)
        for index, row in enumerate(rows):
            required=max(len(wrap(value, span-12, size=size)) for value,span in zip(row,spans))*(size+3)+6
            if y-required < 38:
                y=new_page(label+' - متابعة');y=draw(headers,y,NAVY,True)
            fill=fills[index] if fills else ('F3F6F9' if index%2==0 else None)
            if isinstance(fill,list):
                fill=list(reversed(fill))
            y=draw(row,y,fill)
        return y
    summary=report['summary']
    y=new_page('ملخص التقرير')
    y=text(f"شعب القسم {summary['departmentSections']}، المجدول {summary['scheduledSections']}، غير المغطى {summary['gaps']}، الشعب العامة الخارجية {summary['externalSections']}.",width-margin,y,usable,10)
    if summary['studentCount'] is not None:
        y=text('إجمالي المتدربين، شامل التعاوني: '+str(summary['studentCount']),width-margin,y-3,usable,10)
    y=table(y-10,['الرمز','المدرب أو المجموعة أو القاعة','الشعب','تدريبية','الوقت الفعلي','المتدربون'],
        [[e['id'],e['title'],str(e['sectionCount']),str(e['trainingHours']),clock(e['clockMinutes']),str(e.get('students',''))] for e in report['entities']],
        [75,usable-365,60,70,90,70],'ملخص التقرير')
    if report['notes']:
        note=' '.join(report['notes'])
        required=len(wrap(note,usable,size=8))*11+12
        if y-required<32:
            y=new_page('ملخص التقرير - ملاحظات')
        y=text(note,width-margin,y-12,usable,8,color='52677A')
    for entity in report['entities']:
        y=new_page(entity['title'])
        stats=f"الشعب المجدولة {entity['sectionCount']}، الساعات التدريبية {entity['trainingHours']}، الوقت الفعلي {clock(entity['clockMinutes'])}."
        if entity.get('students') is not None:
            stats+=' عدد المتدربين '+str(entity['students'])+'.'
        y=text(stats,width-margin,y,usable,9)
        rows=[];fills=[]
        for start in starts(entity):
            row=[clock(start)];colors=[None]
            for day,_ in DAYS:
                meetings=[m for m in entity['meetings'] if m['day']==day and m['startMinute']==start]
                row.append('\n'.join(cell_lines(meetings,report['kind'])) or ' ')
                colors.append(AMBER if any(m['warning'] for m in meetings) else GREEN if meetings and all(m['component']=='عملي' for m in meetings) else BLUE if meetings else None)
            rows.append(row);fills.append(colors)
        y=table(y-9,['البداية']+[name for _,name in DAYS],rows,[54]+[(usable-54)/5]*5,entity['title'],fills,size=8.5)
        for note in entity['notes']+([] if entity['meetings'] else ['لا توجد محاضرات أسبوعية مسندة في هذه اللقطة.']):
            y=text(note,width-margin,y-15,usable,9)
        if entity['pending']:
            if y<85:
                y=new_page(entity['title']+' - مقررات غير مجدولة')
            y=text('مقررات المجموعة التي لم يكتمل جدولها',width-margin,y-19,usable,10,True)
            y=table(y-8,['المقرر','اسم المقرر','الشعبة التخطيطية','طلاب الشعبة','الحالة'],
                [[p['courseCode'],p['title'],p['sectionId'],str(p['students']),p['status']] for p in entity['pending']],
                [95,usable-420,150,65,110],entity['title']+' - مقررات غير مجدولة',size=8)
    if report['pending'] and report['kind']!='trainees':
        y=new_page('الشعب غير المغطاة والإسناد الخارجي')
        table(y,['المقرر','اسم المقرر','الشعبة التخطيطية','المستوى','طلاب الشعبة','الحالة'],
            [[p['courseCode'],p['title'],p['sectionId'],str(p['level']),str(p['students']),p['status']] for p in report['pending']],
            [90,usable-450,145,50,55,110],'الشعب غير المغطاة والإسناد الخارجي',size=8)
    significant=[i for i in report['issues'] if i['code'] in ('ECONOMICS_COHORT_OVERLAP','TIMETABLE_COLLISION','ROOM_OCCUPIED','TRAINER_COLLISION','INVALID_TIME')]
    if significant:
        y=new_page('تنبيهات الجدولة')
        table(y,['الخطورة','التفاصيل'],[[i['severity'],i['message']] for i in significant],[90,usable-90],'تنبيهات الجدولة')
    c.save()
    return out.getvalue()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--format',choices=['xlsx','pdf'],required=True)
    args=parser.parse_args()
    payload=json.load(sys.stdin.buffer)
    if payload.get('version')!=1 or payload.get('kind') not in ('instructors','trainees','rooms') or len(payload.get('entities',[]))>500:
        raise ValueError('Invalid report payload')
    sys.stdout.buffer.write(export_xlsx(payload) if args.format=='xlsx' else export_pdf(payload))

if __name__=='__main__':
    try:
        main()
    except Exception as error:
        print('Schedule report export failed: '+str(error),file=sys.stderr)
        sys.exit(2)
