import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {moveScheduledSession} from '../src/manual-schedule.js';
import {assessReadiness} from '../src/api/readiness.js';
import type {PlanRequest} from '../src/types.js';

function fixture():PlanRequest{
  return {scenarioName:'Manual move unit',termId:'TEST',policy:defaultPolicy(),
    courses:[{code:'A-1',title:'Course',level:1,demand:20,theoryHours:2,practicalHours:0,
      mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['B-1']}],
    instructors:[
      {id:'I-1',name:'Trainer one',maxLoad:18,allowedModes:['ONSITE']},
      {id:'I-2',name:'Trainer two',maxLoad:18,allowedModes:['ONSITE']}
    ],
    rooms:[{id:'R-1',name:'Classroom',type:'CLASSROOM',capacity:30},
      {id:'R-2',name:'Lab',type:'LAB',capacity:30}]
  };
}
test('manual timetable move is immutable, recomputes credited load and respects half-hours',()=>{
  const input=fixture(),draft=buildDraftPlan(input);
  assert.equal(draft.gaps.length,0);
  const original=draft.sessions[0]!;
  const moved=moveScheduledSession(input,draft,{
    sessionId:original.id,day:'TUE',start:9.5,roomId:'R-1',instructorId:'I-2'});
  assert.equal(original.instructorId,'I-1','original snapshot must remain unchanged');
  assert.equal(moved.sessions[0]!.start,9.5);
  assert.equal(moved.sessions[0]!.end,11.5);
  assert.equal(moved.sections[0]!.instructorId,'I-2');
  assert.equal(moved.instructorLoads.find(i=>i.id==='I-1')!.credited,0);
  assert.equal(moved.instructorLoads.find(i=>i.id==='I-2')!.credited,2);
  assert.equal(moved.metrics.assignedContactHours,2);
});
test('manual changes refuse wrong room type, wrong half-hour or outside policy window',()=>{
  const input=fixture(),draft=buildDraftPlan(input),id=draft.sessions[0]!.id;
  const move={sessionId:id,day:'TUE' as const,start:9,roomId:'R-1',instructorId:'I-1'};
  assert.throws(()=>moveScheduledSession(input,draft,{...move,roomId:'R-2'}),/Room capacity or component/);
  assert.throws(()=>moveScheduledSession(input,draft,{...move,start:9.25}),/30-minute/);
  assert.throws(()=>moveScheduledSession(input,draft,{...move,day:'THU',start:10}),/INVALID_TIME/);
});
test('manual changes never bypass a locked course instructor',()=>{
  const input=fixture();input.courses[0]!.assignedInstructorId='I-1';
  const plan=buildDraftPlan(input);
  assert.throws(()=>moveScheduledSession(input,plan,{sessionId:plan.sessions[0]!.id,
    day:'MON',start:10,roomId:'R-1',instructorId:'I-2'}),/locked/);
});

test('an operator can repair a pre-existing trainer/room/cohort collision but cannot make it worse',()=>{
  const input=fixture();
  input.courses.push({code:'A-2',title:'Course two',level:1,demand:20,
    theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['B-1']});
  const plan=buildDraftPlan(input);
  assert.equal(plan.sessions.length,2);
  const first=plan.sessions[0]!,second=plan.sessions[1]!;
  second.day=first.day;second.start=first.start;second.end=first.end;
  second.roomId=first.roomId;second.instructorId=first.instructorId;
  const original=assessReadiness(input,plan,'COMPLETED');
  assert.equal(original.technicalReady,false);
  assert.ok(original.issues.some(i=>i.code==='TRAINER_COLLISION'));
  const repaired=moveScheduledSession(input,plan,{
    sessionId:second.id,day:'TUE',start:10,roomId:'R-1',instructorId:'I-1'});
  const after=assessReadiness(input,repaired,'COMPLETED');
  assert.equal(after.technicalReady,true,JSON.stringify(after.issues));
  assert.equal(plan.sessions[1]!.day,first.day,'Input scenario remains unchanged');
  assert.throws(()=>moveScheduledSession(input,plan,{
    sessionId:second.id,day:first.day,start:first.start,roomId:'R-1',instructorId:'I-1'}),
    /strictly reduce existing blockers/);
});
