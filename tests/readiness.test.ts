import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {assessReadiness} from '../src/api/readiness.js';
import type {PlanRequest} from '../src/types.js';

const fixture=():PlanRequest=>({
  scenarioName:'Synthetic readiness',termId:'TEST-TERM',policy:defaultPolicy(),
  courses:[{code:'TEST-101',title:'Synthetic theory',level:1,demand:20,
    theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['BLK-1']}],
  instructors:[{id:'I-1',name:'Synthetic trainer',maxLoad:18,allowedModes:['ONSITE']}],
  rooms:[{id:'R-1',name:'Synthetic classroom',type:'CLASSROOM',capacity:30}]
});
test('readiness is not approval-ready while the optimizer has not run',()=>{
  const input=fixture(),draft=buildDraftPlan(input);
  assert.equal(assessReadiness(input,draft,'NOT_RUN').technicalReady,false);
  assert.ok(assessReadiness(input,draft,'NOT_RUN').issues.some(i=>i.code==='SOLVER_NOT_COMPLETED'));
});
test('a feasible completely identified synthetic timetable passes independent readiness checks',()=>{
  const input=fixture(),draft=buildDraftPlan(input);
  assert.equal(draft.gaps.length,0);
  const report=assessReadiness(input,draft,'COMPLETED');
  assert.equal(report.technicalReady,true,JSON.stringify(report.issues));
  assert.equal(report.byCourse[0]?.sections,1);
});
test('missing cohort, room capacity and overlapping meetings are separately flagged',()=>{
  const input=fixture(),draft=buildDraftPlan(input);
  draft.sections[0]!.blockId=null;
  input.rooms[0]!.capacity=10;
  draft.sessions.push({...draft.sessions[0]!,id:'OVERLAP',sectionId:'TEST-101-001'});
  const report=assessReadiness(input,draft,'COMPLETED');
  assert.equal(report.technicalReady,false);
  for(const code of ['MISSING_BLOCK','ROOM_CAPACITY','INCOMPLETE_HOURS','TIMETABLE_COLLISION'])
    assert.ok(report.issues.some(i=>i.code===code),code);
});

test('approval is blocked by illegal time, wrong room type and trainer unavailability',()=>{
  const input=fixture(),draft=buildDraftPlan(input);
  input.rooms[0]!.type='LAB';
  input.instructors[0]!.available=[{day:'SUN',from:15,to:16}];
  draft.sessions[0]!.start=7;
  draft.sessions[0]!.end=9;
  const report=assessReadiness(input,draft,'COMPLETED');
  assert.equal(report.technicalReady,false);
  for(const expected of ['INVALID_TIME','ROOM_INCOMPATIBLE','INSTRUCTOR_UNAVAILABLE'])
    assert.ok(report.issues.some(i=>i.code===expected),expected);
});

test('phase 11 collision warnings name the resource and attach each affected section',()=>{
  const input=fixture(),draft=buildDraftPlan(input);
  const first=draft.sessions[0]!;
  const overlap={...first,id:'SECOND-SESSION',sectionId:'SECOND-SECTION',courseCode:'TEST-101'};
  draft.sections.push({...draft.sections[0]!,id:'SECOND-SECTION'});
  draft.sessions.push(overlap);
  const report=assessReadiness(input,draft,'COMPLETED');
  for(const code of ['TRAINER_COLLISION','ROOM_OCCUPIED','BLOCK_COLLISION','TIMETABLE_COLLISION']){
    const issues=report.issues.filter(x=>x.code===code);
    assert.equal(issues.length,2,code+' must be linked to both sections');
    assert.ok(issues.some(x=>x.sectionId===first.sectionId));
    assert.ok(issues.some(x=>x.sectionId===overlap.sectionId));
    assert.match(issues[0]!.message,/SECOND-SESSION/);
  }
});
test('unapproved course delivery mode is a distinct readiness blocker',()=>{
  const input=fixture(),draft=buildDraftPlan(input);
  input.courses[0]!.mode='REMOTE';
  const issues=assessReadiness(input,draft,'COMPLETED').issues;
  assert.ok(issues.some(i=>i.code==='COURSE_MODE_INELIGIBLE'&&i.courseCode==='TEST-101'));
});
