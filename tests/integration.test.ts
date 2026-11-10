import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importCurriculumCsv, parseCsv} from '../src/importer.js';
import {prepareSolverPayload, applySolverChoice, optimizeWithTimefold} from '../src/optimizer.js';
import type {PlanRequest} from '../src/types.js';

const fixture = (): PlanRequest => JSON.parse(readFileSync('examples/onsite.json', 'utf8')) as PlanRequest;
test('CSV handles quotes, BOM, multiline values and escaped quotes', () => {
  assert.deepEqual(parseCsv('\uFEFFcode,title\r\nA,"Hello, ""world"""\r\nB,"Line1\nLine2"\r\n'),
    [['code','title'],['A','Hello, "world"'],['B','Line1\nLine2']]);
});
test('CSV plan import correctly uses second duplicate level column and excludes project/co-op', () => {
  const csv = 'الفصل التدريبي,المقرر,اسم المقرر,الفصل التدريبي,مح,عم,تم,س\n'
    + '1448,ادار-101,مبادئ إدارة الأعمال,الفصل التدريبي الأول,3,0,1,4\n'
    + '1448,ادار-111,الاتصالات الإدارية,الفصل التدريبي الثاني,2,2,0,4\n'
    + '1448,ادار-288,مشروع إنتاجي,الفصل التدريبي الرابع,2,0,0,2\n'
    + '1448,ادار-299,التدريب التعاوني,الفصل التدريبي الخامس,0,0,0,0\n';
  const r = importCurriculumCsv(csv);
  assert.equal(r.courses.length, 2);
  assert.deepEqual(r.courses.map(c=>c.level), [1,2]);
  assert.deepEqual(r.courses.map(c=>c.theoryHours), [4,2]);
  assert.ok(r.courses.every(c=>c.demand === 0 && c.mode === 'ONSITE'));
  assert.deepEqual(r.ignored.map(x=>x.reason), ['PROJECT_EXCLUDED_BY_POLICY','NO_WEEKLY_CONTACT_HOURS_COOP_OR_OTHER']);
});
test('CSV rejects broken header and duplicate course', () => {
  assert.throws(() => importCurriculumCsv('wrong,header\na,b\n'), /Required catalog column/);
  const s='المقرر,اسم المقرر,الفصل التدريبي,مح,عم,تم\nX,واحد,الأول,2,0,0\nX,اثنين,الثاني,2,0,0';
  assert.throws(()=>importCurriculumCsv(s), /Duplicate course code/);
});
test('candidate envelope contains atomic paired schedule alternatives and uncovered option', () => {
  const p=prepareSolverPayload(fixture(), 3);
  assert.equal(p.schemaVersion, 'tps.timefold.v1');
  assert.equal(p.tasks.length, 4);
  for (const task of p.tasks) {
    assert.equal(task.choices[0]?.uncovered, true);
    assert.ok(task.choices.some(c=>!c.uncovered));
    for (const choice of task.choices.filter(c=>!c.uncovered)) {
      const duration=choice.sessions.reduce((a,s)=>a+s.end-s.start, 0);
      assert.equal(duration,task.contactHours);
      assert.ok(choice.sessions.every(s=>s.sectionId === task.id));
    }
  }
  assert.ok(p.tasks.filter(x=>x.courseCode==='ADM-152').every(x=>x.choices.some(c => !c.uncovered &&
    c.sessions.some(s => s.component === 'THEORY') && c.sessions.some(s => s.component === 'PRACTICAL'))));
});
test('valid Timefold selection roundtrips plan, preserving explicit uncovered work', () => {
  const request=fixture();
  const p=prepareSolverPayload(request, 2);
  const choices=p.tasks.map((t,i)=>({taskId:t.id,candidateId:(i===0 ? t.choices.find(c=>!c.uncovered) : t.choices[0])!.id}));
  const r=applySolverChoice(request,p,{schemaVersion:p.schemaVersion,choices,hardScore:0,softScore:-200});
  assert.equal(r.sections.filter(s=>s.state==='SCHEDULED').length,1);
  assert.equal(r.gaps.length,3);
  assert.ok(r.sessions.length>0);
  assert.equal(r.metrics.assignedContactHours + r.metrics.uncoveredContactHours,r.metrics.requiredContactHours);
});
test('Timefold response must match exact generated candidates and not exceed trainer load', () => {
  const request=fixture();
  const p=prepareSolverPayload(request,1);
  assert.throws(()=>applySolverChoice(request,p,{schemaVersion:p.schemaVersion,
    choices:p.tasks.map(t=>({taskId:t.id,candidateId:'tampered'})),hardScore:0,softScore:0}),/Unknown solver candidate/);
  assert.throws(()=>applySolverChoice(request,p,{schemaVersion:p.schemaVersion,
    choices:p.tasks.map(t=>({taskId:t.id,candidateId:t.choices[0]!.id})),hardScore:-1,softScore:0}),/hard-constraint/);
});
test('optimizer fails closed without executable jar instead of relabeling greedy results', async () => {
  await assert.rejects(optimizeWithTimefold(fixture(),{jar:'/not-found/tps.jar'}));
});
