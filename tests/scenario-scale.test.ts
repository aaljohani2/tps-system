import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {prepareSolverPayload} from '../src/optimizer.js';
import type {PlanRequest} from '../src/types.js';

function fixture():PlanRequest{
  const courses=Array.from({length:25},(_,i)=>{
    const level=i%4+1,group=i%20+1;
    return {code:'C'+String(i+1).padStart(2,'0'),title:'Synthetic '+i,level,demand:20,
      theoryHours:2,practicalHours:0,mode:'ONSITE' as const,eligibleModes:['ONSITE' as const],
      blocks:['L'+level+'::B'+group],blockSizes:[20]};
  });
  return {scenarioName:'25 course synthetic acceptance smoke',termId:'TERM-SCALE',policy:defaultPolicy(),courses,
    instructors:Array.from({length:6},(_,i)=>({
      id:'I'+(i+1),name:'Instructor '+i,maxLoad:18,allowedModes:['ONSITE' as const]})),
    rooms:Array.from({length:20},(_,i)=>({
      id:'R'+(i+1),name:'Classroom '+i,type:'CLASSROOM' as const,capacity:30}))
  };
}
test('25 courses / 6 trainers / 20 rooms / 4 levels / 20 block codes can produce bounded candidates',()=>{
  const input=fixture(),start=performance.now();
  const draft=buildDraftPlan(input);
  assert.equal(draft.metrics.sectionCount,25);
  assert.equal(input.rooms.length,20);
  assert.equal(input.instructors.length,6);
  assert.equal(new Set(input.courses.map(c=>c.level)).size,4);
  assert.equal(new Set(input.courses.flatMap(c=>c.blocks??[])).size,20);
  const payload=prepareSolverPayload(input,2);
  assert.equal(payload.tasks.length,25);
  assert.ok(payload.tasks.every(t=>t.choices.some(c=>c.uncovered)));
  assert.ok(payload.tasks.every(t=>t.choices.some(c=>!c.uncovered)));
  assert.ok(performance.now()-start<12000,'candidate generation takes unexpectedly long in CI');
});
