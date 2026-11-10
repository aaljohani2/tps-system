import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {readAutomaticWorkbook} from '../src/automatic-xlsx.js';
import {extractHistoricalCapacities,extractHistoricalCourseSettings,extractHistoricalLevelCounts,
  importAutomaticCurriculumCsv} from '../src/automatic-planning.js';

test('the bundled UTF-8 curriculum sample is discovered from its own level labels',()=>{
  const plan=importAutomaticCurriculumCsv(readFileSync('web/templates/TPS_Curriculum_144720.csv','utf8'));
  assert.deepEqual(plan.levels.map(level=>[level.level,level.courses.length]),[[1,6],[2,6],[3,6],[4,6]]);
  assert.equal(plan.courses.length,24);
});

test('automatic workbook bridge preserves Arabic and exposes historical counts and scenario settings',async()=>{
  const python=process.env.TPS_PYTHON??(process.platform==='win32'?'python':'python3');
  const bytes=execFileSync(python,['-c',
    "import io,sys;from openpyxl import Workbook;w=Workbook();s=w.active;s.title='المقررات';"+
    "s.append(['رمز المقرر','المستوى','عدد المتدربين','نظري + تمارين','عم','النمط']);"+
    "s.append(['ادار-101','المستوى الأول',165,4,0,'عن بعد']);"+
    "s.append(['اقصد-101','المستوى الأول',165,3,0,'حضوري']);"+
    "s.append(['ادار-111','المستوى الثاني',305,2,2,'مختلط']);"+
    "out=io.BytesIO();w.save(out);sys.stdout.buffer.write(out.getvalue())"
  ],{maxBuffer:2*1024*1024});
  const sheets=await readAutomaticWorkbook(bytes);
  assert.equal(sheets[0]?.name,'المقررات');
  assert.deepEqual(extractHistoricalLevelCounts(sheets[0]!.rows).counts,{1:165,2:305});
  const settings=extractHistoricalCourseSettings(sheets[0]!.rows);
  assert.equal(settings.courseCount,3);
  assert.deepEqual(settings.settings[0],{code:'ادار-101',mode:'REMOTE_THEORY',theoryHours:4,practicalHours:0});
  assert.deepEqual(settings.settings[2],{code:'ادار-111',mode:'MIXED',theoryHours:2,practicalHours:2});
});

test('historical workbook discovery tolerates title rows and reads capacity settings',()=>{
  const courseRows=[
    ['خطة قسم التخصص التجريبي'],
    ['الفصل المرجعي 144720'],
    ['رمز المقرر','المستوى','الطلب المتوقع','نظري + تمارين','عملي','طريقة التدريب'],
    ['ادار-101','المستوى الأول','165','4','0','عن بُعد'],
  ];
  assert.deepEqual(extractHistoricalLevelCounts(courseRows).counts,{1:165});
  assert.deepEqual(extractHistoricalCourseSettings(courseRows).settings[0],{
    code:'ادار-101',mode:'REMOTE_THEORY',theoryHours:4,practicalHours:0,
  });
  assert.deepEqual(extractHistoricalCapacities([
    ['الإعداد','القيمة'],
    ['سعة نظري أونلاين','100'],
    ['سعة نظري حضوري','50'],
    ['سعة عملي / زوج مختلط','40'],
  ]),{remoteTheory:100,onsiteTheory:50,practical:40,mixed:40});
});
