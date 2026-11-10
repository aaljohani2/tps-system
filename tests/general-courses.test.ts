import test from 'node:test';
import assert from 'node:assert/strict';
import type {PlanRequest,Session} from '../src/types.js';
import {defaultPolicy} from '../src/policy.js';
import {withRequestedLecturePeriods} from '../src/lecture-periods.js';
import {buildDraftPlan} from '../src/planner.js';
import {validateRequest} from '../src/validation.js';
import {generalLockConflict,mapGeneralCourses,type GeneralSourceItem} from '../src/general-courses.js';
import {assessReadiness} from '../src/api/readiness.js';
import {prepareSolverPayload,applySolverChoice,optimizeWithTimefold} from '../src/optimizer.js';
import {intervalQuality,measureSchedule,refinementWeights} from '../src/schedule-refinement.js';
import {buildScenarioReport} from '../src/scenario-reports.js';
import {moveScheduledSession} from '../src/manual-schedule.js';

const source={file:'synthetic.xlsx',sha256:'a'.repeat(64),receivedAt:'2026-11-09'};
function item(overrides:Partial<GeneralSourceItem>={}):GeneralSourceItem {
 return {id:'الإدارة!B4',sheet:'الإدارة',level:1,sourceGroup:'الإدارة:L1:G1',sourceGroupNumber:1,headerCell:'A2',sourceCells:['A2','B4','B3','A4','A5'],
  rawTitle:'انجليزي 1',normalizedTitle:'انجليزي 1',kind:'DAY',day:'SUN',literalStartMinute:480,literalEndMinute:580,startMinute:480,endMinute:580,
  timingStatus:'EXPLICIT_INTERVAL',identifiersUnverified:[],relation:'SINGLE_SOURCE_OCCURRENCE',...overrides};
}
function fixture():PlanRequest {
 return {scenarioName:'Synthetic provisional general courses',termId:'TEST',policy:withRequestedLecturePeriods(defaultPolicy(),'TRIM_END'),
  cohortBlocks:[{ref:'L1::A',level:1,size:20}],
  courses:[{code:'MAIN',title:'Internal course',level:1,demand:20,theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],
    blocks:['L1::A'],blockSizes:[20],blockGroups:[['L1::A']]},
   {code:'انجل-111',title:'لغة إنجليزية (1)',level:1,demand:20,theoryHours:4,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],
    assignmentScope:'EXTERNAL',externalSectionCapacity:40,sectionCapacity:40,blocks:['L1::A'],blockSizes:[20],blockGroups:[['L1::A']]}],
  instructors:[{id:'T',name:'Real trainer',maxLoad:24,allowedModes:['ONSITE'],eligibleCourseCodes:['MAIN']}],
  rooms:[{id:'R',name:'Known classroom',type:'CLASSROOM',capacity:40}]};
}
test('a matching ordinal or title alone never creates a verified general-course lock',()=>{
 const input=fixture(),before=structuredClone(input),schedule=mapGeneralCourses(input,[item()],source,'BASE');
 assert.equal(schedule.locks.length,0);assert.equal(schedule.mappings[0]!.matchStatus,'POSSIBLE');assert.deepEqual(input,before);
 const withAssumption=mapGeneralCourses(input,[item()],source,'BASE','Explicit user planning assumption');
 assert.equal(withAssumption.locks.length,1);assert.equal(withAssumption.mappings[0]!.matchStatus,'POSSIBLE');
 assert.equal(withAssumption.locks[0]!.instructorId,null);assert.equal(withAssumption.locks[0]!.responsibleLabel,'قسم الدراسات العامة');
});
test('duplicate spellings, evening, self-paced, cancellation, 50365 and other departments do not create extra demand',()=>{
 const input=fixture(),items=[item(),item({id:'الإدارة!G4',kind:'EVENING',rawTitle:'إنجليزي',literalStartMinute:960,startMinute:null,endMinute:null}),
  item({id:'الإدارة!C4',rawTitle:'انجليزي1\n50365',identifiersUnverified:['50365'],sourceGroupNumber:2}),
  item({id:'الإدارة!E4',kind:'SELF_PACED',rawTitle:'انجليزي ذاتي'}),item({id:'الإدارة!F4',kind:'CANCELLED',rawTitle:'إلغاء'}),
  item({id:'الحاسب!B4',sheet:'الحاسب'})];
 input.generalCourseSchedule=mapGeneralCourses(input,items,source,'BASE','User planning assumption');
 const result=buildDraftPlan(input);assert.equal(result.externalSections!.length,1);assert.equal(result.externalSections![0]!.contactHours,4);
 assert.equal(input.generalCourseSchedule.locks.length,1);assert.equal(input.generalCourseSchedule.locks[0]!.externalSectionId,'انجل-111-EXT-001');
 assert.equal(input.generalCourseSchedule.mappings.at(-1)!.basis,'OUT_OF_SCOPE');
 assert.equal(input.generalCourseSchedule.mappings[0]!.relation,'UNRESOLVED_DAY_EVENING');
 assert.ok(assessReadiness(input,result,'COMPLETED').issues.some(i=>i.code==='GENERAL_INTEGRATION_INCOMPLETE'));
});
test('stale memberships, fabricated intervals and duplicated general locks are rejected',()=>{
 const input=fixture();input.generalCourseSchedule=mapGeneralCourses(input,[item()],source,'BASE','User planning assumption');validateRequest(input);
 for(const change of [(v:PlanRequest)=>{v.generalCourseSchedule!.locks[0]!.blockIds=['UNKNOWN'];},
  (v:PlanRequest)=>{v.generalCourseSchedule!.locks[0]!.endMinute=820;},
  (v:PlanRequest)=>{v.generalCourseSchedule!.locks.push(structuredClone(v.generalCourseSchedule!.locks[0]!));}]){
  const broken=structuredClone(input);change(broken);assert.throws(()=>validateRequest(broken),/general-course/);
 }
});
test('fixed general-course cohorts and known real resources block even Economics overlaps',()=>{
 const input=fixture(),lock=mapGeneralCourses(input,[item()],source,'BASE','User planning assumption').locks[0]!;
 const session={id:'E',sectionId:'E',courseCode:'اقصد-101',day:'SUN',start:8,end:9.5,instructorId:'T',roomId:'R',blockId:'L1::A',cohortOverlapWarning:true} as Session;
 assert.equal(generalLockConflict(session,lock),true);
 assert.equal(generalLockConflict({...session,blockId:'OTHER'},lock),false);
 assert.equal(generalLockConflict({...session,blockId:'OTHER'},{...lock,roomId:'R'}),true);
 assert.equal(generalLockConflict({...session,blockId:'OTHER'},{...lock,instructorId:'T'}),true);
 assert.equal(generalLockConflict({...session,start:580/60,end:11},lock),false);
});
test('planner, Timefold candidates, independent readiness and solver-response validation enforce general locks',()=>{
 const input=fixture();input.generalCourseSchedule=mapGeneralCourses(input,[item()],source,'BASE','User planning assumption');
 const draft=buildDraftPlan(input),payload=prepareSolverPayload(input,6),task=payload.tasks[0]!;
 assert.ok(draft.sessions.every(s=>!generalLockConflict(s,input.generalCourseSchedule!.locks[0]!)));
 assert.ok(task.choices.every(c=>c.sessions.every(s=>!generalLockConflict(s,input.generalCourseSchedule!.locks[0]!))));
 const choice=task.choices.find(c=>!c.uncovered)!;
 choice.sessions[0]!.day='SUN';choice.sessions[0]!.start=8;choice.sessions[0]!.end=580/60;
 assert.throws(()=>applySolverChoice(input,payload,{schemaVersion:'tps.timefold.v1',hardScore:0,softScore:0,choices:[{taskId:task.id,candidateId:choice.id}]}),/general-course/);
 draft.sessions[0]!.day='SUN';draft.sessions[0]!.start=8;draft.sessions[0]!.end=580/60;
 assert.ok(assessReadiness(input,draft,'COMPLETED').issues.some(i=>i.code==='GENERAL_COHORT_OR_RESOURCE_CONFLICT'));
});
test('student metrics count exact cohort sizes, documented intervals only and normal breaks separately',()=>{
 assert.deepEqual(intervalQuality([{day:'SUN',start:480,end:580,onsite:true},{day:'SUN',start:600,end:700,onsite:true},
  {day:'SUN',start:720,end:770,onsite:true}]),{idleMinutes:40,avoidableGapMinutes:0,days:1,splitDays:0,overlapMinutes:0});
 const input=fixture();input.generalCourseSchedule=mapGeneralCourses(input,[item()],source,'BASE','User planning assumption');
 const result=buildDraftPlan(input),metrics=measureSchedule(input,result);
 assert.equal(metrics.externalRequiredSectionTrainingHours,4);assert.equal(metrics.externalFixedSectionTrainingHours,2);
 assert.equal(metrics.externalPendingSectionTrainingHours,2);assert.equal(metrics.generalCoverageComplete,false);assert.equal(metrics.population,20);
});
test('pending source details prevent approval without preventing safe internal edits or permitting a new general clash',()=>{
 const input=fixture();input.generalCourseSchedule=mapGeneralCourses(input,[item()],source,'BASE','User planning assumption');
 const result=buildDraftPlan(input),session=result.sessions[0]!;
 const moved=moveScheduledSession(input,result,{sessionId:session.id,day:'MON',start:10,roomId:'R',instructorId:'T'});
 assert.equal(moved.sessions[0]!.day,'MON');assert.equal(assessReadiness(input,moved,'COMPLETED').technicalReady,false);
 assert.throws(()=>moveScheduledSession(input,result,{sessionId:session.id,day:'SUN',start:8,roomId:'R',instructorId:'T'}),/GENERAL_COHORT_OR_RESOURCE_CONFLICT/);
});
test('reports keep provisional general meetings in trainee schedules and distinguish department placeholder from real trainers',()=>{
 const input=fixture();input.generalCourseSchedule=mapGeneralCourses(input,[item()],source,'BASE','User planning assumption');
 const result=buildDraftPlan(input),metadata={scenarioId:'ID',scenarioName:input.scenarioName,state:'DRAFT',solverStatus:'COMPLETED',revision:1,policyRevision:1,
  collegeName:'Synthetic college',departmentName:'Synthetic department',termLabel:'TEST',termCode:'TEST',generatedAt:'2026-11-09'};
 const issues=assessReadiness(input,result,'COMPLETED').issues;
 const trainees=buildScenarioReport(input,result,metadata,'trainees',issues),trainers=buildScenarioReport(input,result,metadata,'instructors',issues),rooms=buildScenarioReport(input,result,metadata,'rooms',issues);
 assert.equal(trainees.entities[0]!.meetings.filter(m=>m.sourceRef).length,1);
 assert.equal(trainers.entities.find(e=>e.id==='T')!.trainingHours,2);
 assert.equal(trainers.entities.find(e=>e.id==='GENERAL_STUDIES')!.trainingHours,2);
 assert.ok(trainers.entities.find(e=>e.id==='GENERAL_STUDIES')!.notes.some(n=>n.includes('ليس جدول مدرب واحد')));
 assert.equal(rooms.entities[0]!.meetings.filter(m=>m.sourceRef).length,0);
 assert.equal(trainees.pending.length,1);assert.equal(trainees.pending[0]!.trainingHours,4);
});
test('scenario refinement retains real baseline instructors and actual Timefold while legacy payloads stay unchanged',async()=>{
 const input=fixture(),reference=buildDraftPlan(input),oldPayload=prepareSolverPayload(input,4);
 assert.equal(oldPayload.refinement,undefined);assert.equal(oldPayload.seed,undefined);
 input.generalCourseSchedule=mapGeneralCourses(input,[item()],source,'BASE','User planning assumption');
 input.scheduleRefinement={version:1,baselineScenarioId:'BASE',alternative:'B',seed:42,keepInstructors:true,referenceSessions:reference.sessions,
  referenceInstructors:Object.fromEntries(reference.sections.filter(s=>s.instructorId).map(s=>[s.id,s.instructorId!])),weights:refinementWeights.B};
 const before=structuredClone(input),result=await optimizeWithTimefold(input,{seconds:1,candidatesPerInstructor:8});
 assert.equal(result.gaps.length,0);assert.equal(result.sections[0]!.instructorId,'T');assert.deepEqual(input,before);
 assert.ok(result.notices.some(n=>n.includes('hard=0')));assert.ok(result.sessions.every(s=>!generalLockConflict(s,input.generalCourseSchedule!.locks[0]!)));
});
