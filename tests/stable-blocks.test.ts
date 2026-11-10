import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';
import {withRequestedLecturePeriods} from '../src/lecture-periods.js';
import {createStableBlockPlan,sourceRowsHash,stableGeneralLocks,campusDays,validateStableBlocks,stableBlockDiagnostics,type FixedGeneralSource} from '../src/stable-blocks.js';
import {buildDraftPlan} from '../src/planner.js';
import {prepareSolverPayload,applySolverChoice} from '../src/optimizer.js';
import {validateRequest} from '../src/validation.js';
import {assessReadiness} from '../src/api/readiness.js';
import type {PlanRequest,Session} from '../src/types.js';
function fixture():PlanRequest {
 const policy=withRequestedLecturePeriods(defaultPolicy(),'TRIM_END');policy.capacities.ONSITE={theory:120,practical:120};
 return {scenarioName:'Synthetic',termId:'SYNTHETIC',policy,
  projection:{key:'BASE',label:'Synthetic',sourceTermId:'SYNTHETIC',newIntake:157,levelStudents:{1:157,2:172,3:120,4:97,5:29},cooperativeStudents:29,cooperativeAdministrativeBlocks:1,baseBlocksByLevel:{},assumptions:[],rules:{theory:120,mixed:120,practical:40,economics:50}},
  courses:[{code:'ادار-101',title:'Principles',level:1,demand:157,theoryHours:4,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],sectionCapacity:120,blocks:['old1','old2'],blockSizes:[120,37]},
   {code:'اقصد-101',title:'Economics',level:1,demand:157,theoryHours:3,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],sectionCapacity:50,blocks:['a','b','c','d'],blockSizes:[50,50,50,7],assignedInstructorId:'2'},
   {code:'انجل-111',title:'English',level:1,demand:157,theoryHours:4,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],assignmentScope:'EXTERNAL',sectionCapacity:40}],
  instructors:[{id:'4',name:'Principles trainer',maxLoad:22,allowedModes:['ONSITE']},{id:'2',name:'Economics trainer',maxLoad:12,allowedModes:['ONSITE'],exclusiveCourseCodes:['اقصد-101']}],
  rooms:[{id:'R',name:'Synthetic room',type:'CLASSROOM',capacity:120}]};
}
function row(overrides:Partial<FixedGeneralSource>={}):FixedGeneralSource {
 return {id:'الإدارة!B4',sheet:'الإدارة',level:1,sourceGroup:'G1',sourceGroupNumber:1,headerCell:'A2',sourceCells:['B4'],rawTitle:'English',normalizedTitle:'English',kind:'DAY',day:'SUN',literalStartMinute:480,literalEndMinute:580,startMinute:480,endMinute:580,timingStatus:'EXPLICIT_INTERVAL',identifiersUnverified:[],relation:'UNRESOLVED',courseCode:'انجل-111',physicalColored:false,plannedMode:'REMOTE',deliveryMarker:'CANDIDATE_TIMED',...overrides};
}
test('actual populations use fixed 40-sized memberships; section counts and source rows remain unchanged',()=>{
 const base=fixture(),before=structuredClone(base),rows=[row(),row({id:'الإدارة!G5',kind:'EVENING',startMinute:null,endMinute:null})];
 const input=createStableBlockPlan(base,'BASE',rows,'a'.repeat(64));validateRequest(input);
 assert.deepEqual(base,before);assert.equal(input.cohortBlocks!.length,15);
 assert.deepEqual(input.cohortBlocks!.filter(b=>b.level===2).map(b=>b.size),[40,40,40,40,12]);
 assert.deepEqual(input.courses.find(c=>c.code==='اقصد-101')!.blockSizes,[40,40,40,37]);
 assert.equal(input.courses.find(c=>c.code==='ادار-101')!.blockSizes!.length,2);
 assert.deepEqual(input.courses.find(c=>c.code==='ادار-101')!.blockSizes,[120,37]);
 assert.equal(input.courses.find(c=>c.code==='ادار-101')!.assignedInstructorId,'4');
 assert.equal(input.policy.capacities.REMOTE.theory,100);assert.ok(!input.policy.slots.some(w=>w.day==='THU'));
 assert.deepEqual(input.stableBlockPlan!.sourceRows,rows);assert.equal(stableGeneralLocks(input).length,1);
 assert.equal(stableGeneralLocks(input)[0]!.mode,'REMOTE');assert.equal(stableGeneralLocks(input)[0]!.roomId,null);
 assert.ok(buildDraftPlan(input).externalSections!.every(s=>s.demandOnly));
});
test('a shared remote meeting consumes time for whole blocks once and cannot exceed 100',()=>{
 const input=createStableBlockPlan(fixture(),'BASE',[row()],'a'.repeat(64));
 input.stableBlockPlan!.bindings[0]!.blockIds=input.cohortBlocks!.filter(b=>b.level===1).slice(0,2).map(b=>b.ref);
 validateStableBlocks(input);assert.equal(stableGeneralLocks(input).length,1);assert.equal(stableGeneralLocks(input)[0]!.students,80);
 input.stableBlockPlan!.bindings[0]!.blockIds=input.cohortBlocks!.filter(b=>b.level===1).map(b=>b.ref);
 assert.throws(()=>validateStableBlocks(input),/capacity/);
});
test('actual campus days union general and practical; remote days do not count; third day is rejected independently',()=>{
 const input=createStableBlockPlan(fixture(),'BASE',[row({physicalColored:true,plannedMode:'ONSITE',day:'MON'})],'a'.repeat(64));
 const b=input.cohortBlocks![0]!.ref;
 const sessions=[{day:'SUN',mode:'ONSITE',blockId:b},{day:'WED',mode:'REMOTE',blockId:b}] as Session[];
 assert.deepEqual(campusDays(input,sessions)[0]!.campusDays,['SUN','MON']);
 sessions.push({day:'TUE',mode:'ONSITE',blockId:b} as Session);
 const draft=buildDraftPlan(input);draft.sessions=sessions;
 assert.ok(stableBlockDiagnostics(input,draft).some(i=>i.code==='CAMPUS_DAY_CAP_EXCEEDED'));
});
test('source mode, unknown ends, duplicate identity and fabricated membership fail closed',()=>{
 const input=createStableBlockPlan(fixture(),'BASE',[row(),row({id:'الإدارة!G5',kind:'EVENING',startMinute:960,endMinute:null}),row({id:'الإدارة!P5',kind:'SELF_PACED'})],'a'.repeat(64));
 assert.equal(stableGeneralLocks(input).length,1);
 const reloaded=structuredClone(input);reloaded.stableBlockPlan!.sourceRows=reloaded.stableBlockPlan!.sourceRows.map(r=>Object.fromEntries(Object.entries(r).reverse()) as unknown as FixedGeneralSource);
 validateStableBlocks(reloaded);
 const altered=structuredClone(input);altered.stableBlockPlan!.sourceRows[0]!.plannedMode='ONSITE';assert.throws(()=>validateRequest(altered),/source inventory/);
 altered.stableBlockPlan!.sourceRowsSha256=sourceRowsHash(altered.stableBlockPlan!.sourceRows);assert.throws(()=>validateRequest(altered),/fill\/mode/);
 const duplicate=structuredClone(input);duplicate.stableBlockPlan!.bindings.push(duplicate.stableBlockPlan!.bindings[0]!);assert.throws(()=>validateRequest(duplicate),/Duplicated/);
});
test('Timefold payload includes fixed general days and hard cap; forged third-day response cannot pass TS validation',()=>{
 const input=createStableBlockPlan(fixture(),'BASE',[row({physicalColored:true,plannedMode:'ONSITE',day:'MON'})],'a'.repeat(64));
 const payload=prepareSolverPayload(input,8);
 assert.equal(payload.refinement!.maxCampusDays,2);assert.equal(payload.refinement!.fixedSessions.length,1);
 assert.ok(payload.tasks.every(t=>t.choices.every(c=>c.sessions.every(s=>s.day!=='THU'))));
 const choices=payload.tasks.map(t=>({taskId:t.id,candidateId:t.choices[0]!.id}));
 const result=applySolverChoice(input,payload,{schemaVersion:'tps.timefold.v1',choices,hardScore:0,softScore:0});
 assert.equal(assessReadiness(input,result,'COMPLETED').technicalReady,false);
 assert.ok(assessReadiness(input,result,'COMPLETED').issues.some(i=>i.code==='GENERAL_RESOURCES_PENDING'));
 const task=payload.tasks.find(t=>t.courseCode==='ادار-101'&&t.choices.some(c=>c.sessions.length===2))!;
 const covered=task.choices.find(c=>c.sessions.length===2)!;
 covered.sessions[0]!.day='SUN';covered.sessions[1]!.day='TUE';
 const forged=choices.map(c=>c.taskId===task.id?{...c,candidateId:covered.id}:c);
 assert.throws(()=>applySolverChoice(input,payload,{schemaVersion:'tps.timefold.v1',choices:forged,hardScore:0,softScore:0}),/general-course/);
});
