import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSmallStableBlocks} from '../src/small-block-closure.js';
import {createStableBlockPlan,stableGeneralLocks,sourceRowsHash,stableBlockDiagnostics,type FixedGeneralSource} from '../src/stable-blocks.js';
import {defaultPolicy} from '../src/policy.js';
import {withRequestedLecturePeriods} from '../src/lecture-periods.js';
import {buildDraftPlan} from '../src/planner.js';
import {validateRequest} from '../src/validation.js';
import {refinementWeights} from '../src/schedule-refinement.js';
import {buildScenarioReport} from '../src/scenario-reports.js';
import type {PlanRequest,PlanResult,Course} from '../src/types.js';
function fixture(){
 const policy=withRequestedLecturePeriods(defaultPolicy(),'TRIM_END');policy.capacities.ONSITE={theory:120,practical:120};
 const course=(code:string,level:number,demand:number,theoryHours:number,practicalHours:number,sizes:number[],cap:number):Course=>
  ({code,title:code,level,demand,theoryHours,practicalHours,mode:'ONSITE',eligibleModes:['ONSITE'],sectionCapacity:cap,blocks:sizes.map((_,i)=>String(i)),blockSizes:sizes});
 const courses=[course('ادار-101',1,157,4,0,[80,77],120),course('اقصد-101',1,157,3,0,[40,40,40,37],50),
  course('ادار-111',2,172,2,2,[120,52],120),course('ادار-151',2,172,0,4,[40,40,40,40,12],40),
  course('ادار-231',4,97,4,0,[97],120),course('ادار-241',4,97,3,0,[57,40],120),course('ادار-253',4,97,0,4,[40,40,17],40),course('ادار-285',4,97,3,0,[57,40],120),
  {...course('انجل-112',2,172,4,0,[40,40,40,40,12],40),assignmentScope:'EXTERNAL' as const,externalSectionCapacity:40}];
 const row:FixedGeneralSource={id:'SOURCE',sheet:'الإدارة',level:2,sourceGroup:'G1',sourceGroupNumber:1,headerCell:'A1',sourceCells:['B1'],rawTitle:'English',normalizedTitle:'English',kind:'DAY',day:'SUN',literalStartMinute:480,literalEndMinute:580,startMinute:480,endMinute:580,timingStatus:'EXPLICIT_INTERVAL',identifiersUnverified:[],relation:'UNRESOLVED',courseCode:'انجل-112',physicalColored:true,plannedMode:'ONSITE',deliveryMarker:'TIMED'};
 const raw:PlanRequest={scenarioName:'Synthetic closure',termId:'TEST',policy,courses,instructors:['1','2','3','4','5','6'].map(id=>({id,name:id,maxLoad:100,allowedModes:['ONSITE'],teachingRules:{preferredCreditedLoad:24}})),rooms:[{id:'R',name:'R',type:'MULTI',capacity:200}],
  projection:{key:'BASE',label:'TEST',sourceTermId:'TEST',newIntake:157,levelStudents:{1:157,2:172,3:120,4:97,5:29},cooperativeStudents:29,cooperativeAdministrativeBlocks:1,baseBlocksByLevel:{},assumptions:[],rules:{theory:120,mixed:120,practical:40,economics:50}}};
 const input=createStableBlockPlan(raw,'BASE',[row],'a'.repeat(64));
 input.scheduleRefinement={version:1,baselineScenarioId:'BASE',alternative:'B',seed:1,keepInstructors:true,referenceSessions:[],referenceInstructors:{},weights:refinementWeights.B,requiredCreditedLoads:{5:24,6:24}};
 // Simulate a saved assignment without inventing feasibility: this fixture tests transforms, not solver success.
 const baseline=buildDraftPlan(input);baseline.gaps=[];baseline.sessions=[];
 for(const s of baseline.sections){s.instructorId=s.id==='ادار-151-005'?'1':s.courseCode==='ادار-101'?'4':s.id==='ادار-253-003'?'6':'5';s.state='SCHEDULED';}
 return {input,baseline};
}
test('approved closures preserve population, general courses/source seats and unrelated limits while reducing actual owned sections',()=>{
 const {input,baseline}=fixture(),before=structuredClone(input),next=closeSmallStableBlocks(input,baseline);
 assert.deepEqual(input,before);validateRequest(next);
 assert.deepEqual(next.cohortBlocks!.filter(b=>b.level===2).map(b=>b.size),[43,43,43,43]);
 assert.deepEqual(next.cohortBlocks!.filter(b=>b.level===4).map(b=>b.size),[49,48]);assert.equal(next.cohortBlocks!.length,13);
 assert.deepEqual(next.courses.find(c=>c.code==='ادار-111')!.blockSizes,[86,86]);
 assert.deepEqual(next.courses.filter(c=>c.assignmentScope==='EXTERNAL'),input.courses.filter(c=>c.assignmentScope==='EXTERNAL'));
 assert.equal(stableGeneralLocks(next)[0]!.students,40);assert.equal(stableGeneralLocks(input)[0]!.students,40);
 assert.equal(sourceRowsHash(next.stableBlockPlan!.sourceRows),sourceRowsHash(input.stableBlockPlan!.sourceRows));
 assert.equal(next.policy.capacities.ONSITE.practical,input.policy.capacities.ONSITE.practical);
 assert.deepEqual(next.policy.courseSectionCapacities,{'ادار-151':43,'ادار-253':49});
 assert.equal(next.scheduleRefinement!.requiredCreditedLoads!['6'],0);assert.equal(next.instructors.find(i=>i.id==='6')!.teachingRules!.preferredCreditedLoad,0);
 assert.ok(!Object.keys(next.scheduleRefinement!.referenceInstructors).some(id=>['ادار-151-005','ادار-253-003'].includes(id)));
 assert.ok(stableBlockDiagnostics(next).some(i=>i.code==='GENERAL_REDISTRIBUTION_PENDING'));
});
test('closure rejects lost students, inflated general seats, unauthorized capacities and extra course closures',()=>{
 const {input,baseline}=fixture(),next=closeSmallStableBlocks(input,baseline);
 for(const change of [(x:PlanRequest)=>{x.cohortBlocks!.find(b=>b.ref==='STABLE-L2::B01')!.size--;},
  (x:PlanRequest)=>{x.stableBlockPlan!.bindings[0]!.blockStudents!['STABLE-L2::B01']=43;},
  (x:PlanRequest)=>{x.policy.courseSectionCapacities!['ادار-253']=50;},
  (x:PlanRequest)=>{x.stableBlockPlan!.departmentSectionCounts['ادار-241']=1;}]){
  const changed=structuredClone(next);change(changed);assert.throws(()=>validateRequest(changed));
 }
 assert.throws(()=>closeSmallStableBlocks(next,baseline),/original stable/);
});
test('reports keep 575 students, preserve external demand and disclose pending separate general membership',()=>{
 const {input,baseline}=fixture(),next=closeSmallStableBlocks(input,baseline),draft=buildDraftPlan(next);
 const metadata={scenarioId:'TEST',scenarioName:'TEST',state:'DRAFT',solverStatus:'COMPLETED',revision:1,policyRevision:1,collegeName:'TEST',departmentName:'TEST',termLabel:'TEST',termCode:'TEST',generatedAt:'2026-11-10'};
 const report=buildScenarioReport(next,draft,metadata,'trainees',[]);
 assert.equal(report.summary.studentCount,575);assert.equal(report.entities.filter(e=>e.id.startsWith('L')).length,13);
 assert.ok(report.notes.some(n=>n.includes('توزيع عضويات')));assert.ok(report.entities.find(e=>e.id==='L2-G01')!.notes.some(n=>n.includes('معلق')));
 assert.equal(draft.externalSections!.length,5);assert.deepEqual(draft.externalSections!.map(s=>s.students),[40,40,40,40,12]);
});
