import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';
import {validateRequest} from '../src/validation.js';
import {buildDraftPlan} from '../src/planner.js';
import type {PlanRequest} from '../src/types.js';

function input():PlanRequest{
  return {scenarioName:'Synthetic cohort planning',termId:'TERM-1',policy:defaultPolicy(),
    courses:[{code:'MATH-101',title:'Course with normalized blocks',level:1,
      demand:42,blocks:['C1::A','C1::B'],blockSizes:[22,20],
      theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE']}],
    instructors:[{id:'I1',name:'Synthetic one',maxLoad:18,allowedModes:['ONSITE']}],
    rooms:[{id:'R1',name:'Classroom',type:'CLASSROOM',capacity:30}]};
}
test('each normalized cohort block becomes an exact-size section, never an inferred rounded section',()=>{
  const req=input(),result=buildDraftPlan(req);
  assert.deepEqual(result.sections.map(s=>s.students),[22,20]);
  assert.deepEqual(result.sections.map(s=>s.blockId),['C1::A','C1::B']);
  assert.equal(result.metrics.sectionCount,2);
});
test('a block sum different from forecast demand is rejected before scheduling',()=>{
  const req=input();req.courses[0]!.blockSizes=[22,19];
  assert.throws(()=>validateRequest(req),/Normalized blocks must sum/);
});
test('a block exceeding physical section capacity must be corrected, not split invisibly',()=>{
  const req=input();req.courses[0]!.blocks=['C1::A'];req.courses[0]!.blockSizes=[42];
  assert.throws(()=>validateRequest(req),/Block size exceeds/);
});
test('same student cohort reused in two courses does not overlap in time',()=>{
  const req=input();
  req.courses=[{...req.courses[0]!,demand:22,blocks:['C1::A'],blockSizes:[22]},
    {code:'ENG-101',title:'Other course same block',level:1,demand:22,
      theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],
      blocks:['C1::A'],blockSizes:[22]}];
  const plan=buildDraftPlan(req);
  assert.equal(plan.gaps.length,0,JSON.stringify(plan.gaps));
  for(let i=0;i<plan.sessions.length;i++)for(let j=i+1;j<plan.sessions.length;j++){
    const a=plan.sessions[i]!,b=plan.sessions[j]!;
    if(a.blockId===b.blockId && a.day===b.day)
      assert.ok(a.end<=b.start||b.end<=a.start,'same block has overlapping classes');
  }
});
