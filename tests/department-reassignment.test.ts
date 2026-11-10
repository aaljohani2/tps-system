import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDepartmentReassignment,reassignmentCapacity,withApprovedAfternoonPeriods,planWholeSectionOwnership,matchPrinciplesEconomicsSections} from '../src/department-reassignment.js';
import {defaultPolicy} from '../src/policy.js';
import {withRequestedLecturePeriods} from '../src/lecture-periods.js';
import {sourceRowsHash} from '../src/stable-blocks.js';
import {trainerQualified} from '../src/eligibility.js';
import {prepareSolverPayload} from '../src/optimizer.js';
import {applySolverChoice} from '../src/optimizer.js';
import {refinementWeights} from '../src/schedule-refinement.js';
import {buildDraftPlan} from '../src/planner.js';
import {validateRequest} from '../src/validation.js';
import type {Course,PlanRequest} from '../src/types.js';
function fixture():PlanRequest {
 const policy=withRequestedLecturePeriods(defaultPolicy(),'TRIM_END');policy.slots=policy.slots.filter(w=>w.day!=='THU');policy.capacities.ONSITE={theory:160,practical:160};
 for(const p of Object.values(policy.lecturePeriods!.courseOverrides))p.allowCohortOverlap=false;
 const specs:Array<[string,number,number,number]>=[['ادار-101',4,0,2],['رياد-262',1,2,2],['اقصد-101',3,0,4],['ادار-111',2,2,2],['ادار-121',2,2,1],['ادار-222',3,0,1],['ادار-231',4,0,1],['ادار-241',3,0,2],['ادار-271',3,0,1],['ادار-285',3,0,2],['ادار-151',0,4,4],['ادار-253',0,4,3]];
 const blocks=Array.from({length:4},(_,i)=>({ref:`STABLE-L1::B${String(i+1).padStart(2,'0')}`,level:1,size:40}));
 const courses:Course[]=specs.map(([code,theoryHours,practicalHours,count])=>{
  const groups=Array.from({length:count},()=>[] as string[]);blocks.forEach((b,i)=>groups[i%count]!.push(b.ref));
  return {code,title:code,level:1,demand:160,theoryHours,practicalHours,mode:'ONSITE',eligibleModes:['ONSITE'],...(code==='ادار-101'?{assignedInstructorId:'4'}:{}),sectionCapacity:160,blockGroups:groups,blocks:groups.map(g=>g.join(' + ')),blockSizes:groups.map(g=>g.length*40)};
 });
 return {scenarioName:'Synthetic reassignment',termId:'TEST',policy,cohortBlocks:blocks,courses,
  instructors:['1','2','3','4','5','6'].map(id=>({id,name:id,maxLoad:id==='1'?8:id==='2'?12:id==='4'?22:24,allowedModes:['ONSITE'],teachingRules:{allowedCourseTypes:id==='5'||id==='6'?['THEORY','MIXED']:['THEORY','PRACTICAL']}})),
  rooms:[{id:'R',name:'Synthetic room',type:'MULTI',capacity:200}],
  projection:{key:'STABLE_BLOCKS',label:'Synthetic',sourceTermId:'TEST',newIntake:160,levelStudents:{1:160,2:0,3:0,4:0,5:0},cooperativeStudents:0,cooperativeAdministrativeBlocks:0,baseBlocksByLevel:{1:4},assumptions:[],rules:{theory:160,mixed:160,practical:40,economics:50}},
  stableBlockPlan:{version:1,baselineScenarioId:'BASE',sourceSha256:'a'.repeat(64),sourceRowsSha256:sourceRowsHash([]),sourceRows:[],bindings:[],maxCampusDays:2,remoteSectionCapacity:100,additionalLoadSplits:false,departmentSectionCounts:Object.fromEntries(specs.map(([c,,,n])=>[c,n]))}};
}
test('requested ownership preserves source/memberships/hours and allows trainer 4 only the named mixed course',()=>{
 const base=fixture(),before=structuredClone(base),input=applyDepartmentReassignment(base,'KEEP_WITH_TRAINER_2');
 assert.deepEqual(base,before);
 for(const code of ['ادار-101','رياد-262'])assert.equal(input.courses.find(c=>c.code===code)!.assignedInstructorId,'4');
 assert.equal(trainerQualified(input.instructors.find(i=>i.id==='4')!,input.courses.find(c=>c.code==='رياد-262')!),true);
 assert.equal(trainerQualified(input.instructors.find(i=>i.id==='4')!,input.courses.find(c=>c.code==='ادار-111')!),false);
 assert.deepEqual(input.cohortBlocks,base.cohortBlocks);assert.deepEqual(input.stableBlockPlan,base.stableBlockPlan);
 assert.equal(reassignmentCapacity(input).availableHours,34);assert.equal(reassignmentCapacity(input).shortfallHours,14);
 assert.deepEqual(reassignmentCapacity(input).balancedWholeSectionLoads,[17,17]);
});
test('latest permission includes practical hours in exact 24/24 packing without inventing extra sections',()=>{
 const base=fixture(),input=applyDepartmentReassignment(base,'KEEP_WITH_TRAINER_2',true),capacity=reassignmentCapacity(input);
 assert.equal(capacity.availableHours,62);assert.deepEqual(capacity.balancedWholeSectionLoads,[24,24]);assert.equal(capacity.shortfallHours,0);
 const ids=[...capacity.suggestedTrainer5Sections,...capacity.suggestedTrainer6Sections];assert.equal(new Set(ids).size,ids.length);
 assert.equal(input.courses.find(c=>c.code==='اقصد-101')!.assignedInstructorId,'2');
 assert.deepEqual(input.stableBlockPlan!.departmentSectionCounts,base.stableBlockPlan!.departmentSectionCounts);
 for(const id of ['5','6'])assert.equal(trainerQualified(input.instructors.find(i=>i.id===id)!,input.courses.find(c=>c.code==='ادار-151')!),true);
});
test('explicit Economics transfer changes only the eligible ownership pool, not the available hours or required target',()=>{
 const input=applyDepartmentReassignment(fixture(),'MOVE_TO_TRAINERS_5_6'),capacity=reassignmentCapacity(input);
 assert.equal(capacity.availableHours,46);assert.equal(capacity.shortfallHours,2);assert.deepEqual(capacity.balancedWholeSectionLoads,[23,23]);
 assert.deepEqual(input.instructors.find(i=>i.id==='2')!.eligibleCourseCodes,[]);
 for(const id of ['5','6'])assert.equal(trainerQualified(input.instructors.find(i=>i.id===id)!,input.courses.find(c=>c.code==='اقصد-101')!),true);
});
test('Timefold candidates cannot return entrepreneurship to trainers 5/6 or the remaining theory to trainer 4',()=>{
 const input=applyDepartmentReassignment(fixture(),'KEEP_WITH_TRAINER_2'),payload=prepareSolverPayload(input,3);
 for(const task of payload.tasks)for(const choice of task.choices.filter(c=>!c.uncovered)){
  if(['ادار-101','رياد-262'].includes(task.courseCode))assert.equal(choice.instructorId,'4');
  else if(task.courseCode==='اقصد-101')assert.equal(choice.instructorId,'2');
  else if(!['ادار-151','ادار-253'].includes(task.courseCode))assert.ok(['5','6'].includes(choice.instructorId!));
 }
});
test('stable-block Timefold choices include both compact and two-day placements without Thursday',()=>{
 const input=applyDepartmentReassignment(fixture(),'KEEP_WITH_TRAINER_2',true),payload=prepareSolverPayload(input,24);
 const task=payload.tasks.find(t=>t.courseCode==='ادار-111')!;
 assert.ok(task.choices.some(c=>!c.uncovered&&new Set(c.sessions.map(s=>s.day)).size===1));
 assert.ok(task.choices.some(c=>!c.uncovered&&new Set(c.sessions.map(s=>s.day)).size===2));
 assert.ok(task.choices.every(c=>c.sessions.every(s=>s.day!=='THU')));
});
test('approved afternoon expansion stays in one snapshot, preserves source and adds exactly two 100-minute periods',()=>{
 const base=fixture(),before=structuredClone(base),input=withApprovedAfternoonPeriods(base);
 assert.deepEqual(base,before);assert.equal(input.policy.lecturePeriods!.regular.length,5);
 assert.deepEqual(input.policy.lecturePeriods!.regular.slice(-2),[{startMinute:840,endMinute:940,trainingHours:2},{startMinute:960,endMinute:1060,trainingHours:2}]);
 assert.deepEqual(input.stableBlockPlan,base.stableBlockPlan);assert.ok(!input.policy.slots.some(w=>w.day==='THU'));
 assert.equal(input.policy.lecturePeriods!.regular.reduce((n,p)=>n+p.trainingHours,0)*2,20);
});
test('explicit targets and mandatory ownership cannot be accepted as an uncovered or partially filled solution',()=>{
 const input=withApprovedAfternoonPeriods(applyDepartmentReassignment(fixture(),'KEEP_WITH_TRAINER_2',true));
 input.scheduleRefinement={version:1,baselineScenarioId:'BASE',alternative:'B',seed:42,keepInstructors:false,referenceSessions:[],referenceInstructors:{},weights:refinementWeights.B,
  requiredCreditedLoads:{5:24,6:24},requiredCourseCodes:['ادار-101','رياد-262','اقصد-101']};
 const payload=prepareSolverPayload(input,48);assert.deepEqual(payload.refinement!.requiredCreditedLoads,{5:24,6:24});
 for(const task of payload.tasks.filter(t=>input.scheduleRefinement!.requiredCourseCodes!.includes(t.courseCode)))assert.ok(task.choices.every(c=>!c.uncovered));
 const choices=payload.tasks.map(t=>({taskId:t.id,candidateId:t.choices.find(c=>c.uncovered)?.id??t.choices[0]!.id}));
 assert.throws(()=>applySolverChoice(input,payload,{schemaVersion:'tps.timefold.v1',choices,hardScore:0,softScore:0}),/required instructor load/);
});
test('whole-section ownership realizes exact loads while retaining fixed courses, Khalid sections and every section',()=>{
 const input=withApprovedAfternoonPeriods(applyDepartmentReassignment(fixture(),'KEEP_WITH_TRAINER_2',true));
 const sections=buildDraftPlan(input).sections,assignment=planWholeSectionOwnership(input,sections);
 assert.equal(Object.keys(assignment).length,sections.length);
 for(const id of ['5','6'])assert.equal(sections.filter(s=>assignment[s.id]===id).reduce((n,s)=>n+s.creditedLoad,0),24);
 assert.equal(sections.filter(s=>assignment[s.id]==='1').length,2);
 for(const s of sections)if(['ادار-101','رياد-262','اقصد-101'].includes(s.courseCode))assert.equal(assignment[s.id],s.courseCode==='اقصد-101'?'2':'4');
});
test('necessary late period adds capacity without changing fixed general sources or campus-day cap',()=>{
 const base=fixture(),input=withApprovedAfternoonPeriods(base,true);
 assert.equal(input.policy.lecturePeriods!.regular.length,6);
 assert.deepEqual(input.policy.lecturePeriods!.regular.at(-1),{startMinute:1080,endMinute:1180,trainingHours:2});
 assert.equal(input.stableBlockPlan!.maxCampusDays,2);assert.deepEqual(input.stableBlockPlan!.sourceRows,base.stableBlockPlan!.sourceRows);
});
test('explicit Principles request copies Economics populations and whole memberships without copying hours or owner',()=>{
 const source=applyDepartmentReassignment(fixture(),'KEEP_WITH_TRAINER_2',true),before=structuredClone(source);
 const input=matchPrinciplesEconomicsSections(source),principles=input.courses.find(c=>c.code==='ادار-101')!,economics=input.courses.find(c=>c.code==='اقصد-101')!;
 assert.deepEqual(source,before);assert.deepEqual(principles.blockSizes,economics.blockSizes);assert.deepEqual(principles.blockGroups,economics.blockGroups);
 assert.equal(principles.theoryHours,4);assert.equal(economics.theoryHours,3);assert.equal(principles.assignedInstructorId,'4');assert.equal(economics.assignedInstructorId,'2');
 assert.equal(input.stableBlockPlan!.departmentSectionCounts['ادار-101'],4);assert.equal(input.stableBlockPlan!.principlesEconomicsAlignment!.previousPrinciplesSectionCount,2);
 assert.equal(input.stableBlockPlan!.additionalLoadSplits,false);assert.deepEqual(input.cohortBlocks,source.cohortBlocks);
 assert.deepEqual(input.stableBlockPlan!.sourceRows,source.stableBlockPlan!.sourceRows);
});
test('Principles alignment rejects instructor overload and later drift from Economics section populations',()=>{
 const source=applyDepartmentReassignment(fixture(),'KEEP_WITH_TRAINER_2',true);
 const limited=structuredClone(source);limited.instructors.find(i=>i.id==='4')!.maxLoad=21;
 assert.throws(()=>matchPrinciplesEconomicsSections(limited),/trainer 4 load/);
 const input=matchPrinciplesEconomicsSections(source);input.courses.find(c=>c.code==='ادار-101')!.blockSizes![0]!--;
 assert.throws(()=>validateRequest(input),/match Economics/);
});
