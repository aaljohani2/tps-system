import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {moveScheduledSession} from '../src/manual-schedule.js';
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
