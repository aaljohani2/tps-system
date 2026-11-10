import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {prepareSolverPayload} from '../src/optimizer.js';
import {validateRequest} from '../src/validation.js';
import type {PlanRequest} from '../src/types.js';
function model():PlanRequest{
  const policy=defaultPolicy();
  policy.slots=[{day:'SUN',from:8.5,to:11}];
  return {scenarioName:'Synthetic half-hour time slots',termId:'T1',policy,
    courses:[{code:'A1',title:'Synthetic',level:1,demand:20,theoryHours:2,practicalHours:0,
      mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['C::B1']}],
    instructors:[{id:'I1',name:'Instructor',maxLoad:18,allowedModes:['ONSITE']}],
    rooms:[{id:'R1',name:'Room',type:'CLASSROOM',capacity:30}]};
}
test('half-hour time window validates and is respected by greedy preview',()=>{
  const input=model();
  assert.doesNotThrow(()=>validateRequest(input));
  const plan=buildDraftPlan(input);
  assert.equal(plan.gaps.length,0);
  assert.equal(plan.sessions[0]?.start,8.5);
  assert.equal(plan.sessions.reduce((sum,s)=>sum+s.end-s.start,0),2);
});
test('half-hour slot coordinates remain fractional in Timefold candidate payload',()=>{
  const input=model(),payload=prepareSolverPayload(input);
  const choices=payload.tasks[0]?.choices.filter(c=>!c.uncovered)??[];
  assert.ok(choices.length>0);
  assert.ok(choices.some(c=>c.sessions.some(s=>s.start===8.5)),
    'candidate values must preserve half hours for Java double-based JSON record');
});
test('quarter-hour policy windows are refused',()=>{
  const input=model();
  input.policy.slots=[{day:'SUN',from:8.25,to:11}];
  assert.throws(()=>validateRequest(input),/Invalid time window/);
});
