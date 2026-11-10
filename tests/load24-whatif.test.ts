import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';
import {makeUnapprovedTrainer6CapacityWhatIf} from '../src/load24-whatif.js';
import {verifyLoad24Result} from '../src/load24-verification.js';
import {buildDraftPlan} from '../src/planner.js';
import {optimizeWithTimefold} from '../src/optimizer.js';
import type {PlanRequest} from '../src/types.js';

const verified={trainer5Name:'Synthetic Trainer Five',trainer6Name:'Synthetic Trainer Six'};
function fixture():PlanRequest{
 return {scenarioName:'Synthetic unapproved capacity what-if',termId:'TEST',policy:defaultPolicy(),
  courses:[...Array(6).fill(4),...Array(8).fill(3)].map((hours,index)=>({
   code:'C'+index,title:'Synthetic '+index,level:1,demand:20,theoryHours:hours,
   practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['G'+index]})),
  instructors:[{id:'5',name:'Synthetic Trainer Five',maxLoad:24,allowedModes:['ONSITE']},
    {id:'6',name:'Synthetic Trainer Six',maxLoad:22,allowedModes:['ONSITE']}],
  rooms:[{id:'R1',name:'Room 1',type:'CLASSROOM',capacity:30},
    {id:'R2',name:'Room 2',type:'CLASSROOM',capacity:30}],
  projection:{key:'BASE_157',label:'Synthetic',sourceTermId:'TEST',newIntake:20,
   levelStudents:{1:20,2:0,3:0,4:0,5:0},cooperativeStudents:0,
   cooperativeAdministrativeBlocks:0,
   baseBlocksByLevel:{1:1,2:0,3:0,4:0},assumptions:[],
   rules:{theory:45,mixed:30,practical:30,economics:50}}};
}

test('unapproved extra two hours exist only in an in-memory what-if; original 22-hour source is intact',()=>{
 const source=fixture(),original=structuredClone(source);
 const {simulationSource,input}=makeUnapprovedTrainer6CapacityWhatIf(source,verified);
 assert.deepEqual(source,original);
 assert.equal(source.instructors.find(i=>i.id==='6')?.overload,undefined);
 assert.equal(simulationSource.instructors.find(i=>i.id==='6')?.maxLoad,22);
 assert.equal(simulationSource.instructors.find(i=>i.id==='6')?.overload?.additionalHours,2);
 assert.equal(input.instructors.find(i=>i.id==='6')?.maxLoad,22);
 assert.equal(input.instructors.find(i=>i.id==='6')?.teachingRules?.preferredCreditedLoad,24);
 assert.match(input.instructors.find(i=>i.id==='6')?.overload?.reason??'',/UNAPPROVED/);
});
test('what-if rejects a modified master limit, existing exception, or wrong person-code mapping',()=>{
 const source=fixture();source.instructors[1]!.maxLoad=24;
 assert.throws(()=>makeUnapprovedTrainer6CapacityWhatIf(source,verified),/expected exact 22/);
 source.instructors[1]!.maxLoad=22;
 source.instructors[1]!.overload={additionalHours:2,reason:'Some approved change'};
 assert.throws(()=>makeUnapprovedTrainer6CapacityWhatIf(source,verified),/expected exact 22/);
 delete source.instructors[1]!.overload;
 source.instructors[1]!.name='Unverified Trainer';
 source.instructors[0]!.name='Synthetic Trainer Five';
 // Include a true code-name mismatch without the target name as a substring.
 source.instructors[1]!.name='Different Synthetic Trainer';
 assert.throws(()=>makeUnapprovedTrainer6CapacityWhatIf(source,verified),/identity mismatch/);
});
test('actual Timefold may demonstrate mathematical feasibility but cannot pass official-source integrity gate',async()=>{
 const source=fixture(),before=buildDraftPlan(source);
 const {simulationSource,input}=makeUnapprovedTrainer6CapacityWhatIf(source,verified);
 const outcome=await optimizeWithTimefold(input,{seconds:2,candidatesPerInstructor:3});
 const hypothetical=verifyLoad24Result(simulationSource,before,input,outcome);
 assert.deepEqual(hypothetical.targetLoads,{'5':24,'6':24});
 assert.equal(hypothetical.score.hard,0);
 assert.throws(()=>verifyLoad24Result(source,before,input,outcome),
  /official base limits must not be silently raised/);
 assert.equal(source.instructors.find(i=>i.id==='6')?.maxLoad,22);
});
