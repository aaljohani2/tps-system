import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';
import type {PlanRequest} from '../src/types.js';
import {prepareLoad24Input,verifyLoad24Result} from '../src/load24-verification.js';
import {buildDraftPlan} from '../src/planner.js';
import {optimizeWithTimefold} from '../src/optimizer.js';

function fixture():PlanRequest{
 const policy=defaultPolicy();policy.priorityCourseCodes=['C0','C1'];
 return {scenarioName:'Synthetic 24-hour review',termId:'TEST',policy,
  courses:[...Array(6).fill(4),...Array(8).fill(3)].map((hours,index)=>({
   code:'C'+index,title:'Theory '+index,level:1,demand:20,theoryHours:hours,practicalHours:0,
   mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['G'+index]})),
  instructors:['5','6'].map(id=>({id,name:'Synthetic '+id,maxLoad:24,allowedModes:['ONSITE']})),
  rooms:[{id:'R1',name:'Room A',type:'CLASSROOM',capacity:30},{id:'R2',name:'Room B',type:'CLASSROOM',capacity:30}],
  projection:{key:'BASE_157',label:'Synthetic profile',sourceTermId:'TEST',newIntake:20,
   levelStudents:{1:20,2:0,3:0,4:0,5:0},cooperativeStudents:0,cooperativeAdministrativeBlocks:0,
   baseBlocksByLevel:{1:1,2:0,3:0,4:0},assumptions:[],rules:{theory:45,mixed:30,practical:30,economics:50}}
 };
}
test('24-hour preparation preserves the instructor base limit and all source snapshots',()=>{
 const source=fixture(),copy=structuredClone(source);
 const prepared=prepareLoad24Input(source,()=>{throw Error('Unexpected split for BASE_157');});
 assert.deepEqual(source,copy);
 assert.equal(prepared.instructors[0]!.maxLoad,24);
 assert.deepEqual(prepared.instructors.map(x=>x.teachingRules?.allowedCourseTypes),[['THEORY','MIXED'],['THEORY','MIXED']]);
 assert.deepEqual(prepared.instructors.map(x=>x.teachingRules?.preferredCreditedLoad),[24,24]);
});
test('unapproved increase, missing target, reference scenario and implicit split never proceed',()=>{
 const source=fixture();source.instructors[0]!.maxLoad=23;
 assert.throws(()=>prepareLoad24Input(source,()=>source),/approved capacity/);
 source.instructors[0]!.overload={additionalHours:1,reason:'Synthetic approved local overload'};
 const withApproval=prepareLoad24Input(source,()=>{throw Error('No split expected');});
 assert.equal(withApproval.instructors[0]!.maxLoad,23);
 assert.equal(withApproval.instructors[0]!.overload?.additionalHours,1);
 source.instructors[0]!.maxLoad=24;source.instructors.pop();
 assert.throws(()=>prepareLoad24Input(source,()=>source),/code absent/);
 const ref=fixture();delete ref.projection;
 assert.throws(()=>prepareLoad24Input(ref,()=>ref),/Only the three/);
});
test('actual Timefold result must prove both 24-hour targets and a hard score of zero',async()=>{
 const source=fixture(),before=buildDraftPlan(source);
 const input=prepareLoad24Input(source,()=>{throw Error('Unexpected split');});
 const result=await optimizeWithTimefold(input,{seconds:2,candidatesPerInstructor:3});
 const verified=verifyLoad24Result(source,before,input,result);
 assert.deepEqual(verified.targetLoads,{'5':24,'6':24});
 assert.equal(verified.score.hard,0);
 const deficit=structuredClone(result);deficit.instructorLoads[0]!.credited=23;
 assert.throws(()=>verifyLoad24Result(source,before,input,deficit),/24 credited hours/);
 const fakeHard=structuredClone(result);fakeHard.notices=fakeHard.notices.map(x=>x.startsWith('Solver score: ')?'Solver score: hard=-1, soft=1':x);
 assert.throws(()=>verifyLoad24Result(source,before,input,fakeHard),/zero-hard-score/);
 const population=structuredClone(input);population.courses[0]!.demand++;
 assert.throws(()=>verifyLoad24Result(source,before,population,result),/Course population changed|course fact changed/);
});
