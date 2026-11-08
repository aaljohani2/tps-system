import test from 'node:test';
import assert from 'node:assert/strict';
import type {PlanRequest} from '../src/types.js';
import {defaultPolicy} from '../src/policy.js';
import {withRequestedLecturePeriods,formatClock,validPeriodSession,trainingHours} from '../src/lecture-periods.js';
import {buildDraftPlan} from '../src/planner.js';
import {prepareSolverPayload,optimizeWithTimefold,applySolverChoice} from '../src/optimizer.js';
import {assessReadiness} from '../src/api/readiness.js';
import {moveScheduledSession} from '../src/manual-schedule.js';
import {validateRequest} from '../src/validation.js';

function fixture():PlanRequest{
 const policy=withRequestedLecturePeriods(defaultPolicy(),'TRIM_END');
 policy.slots=[{day:'SUN',from:7,to:14.5}];
 return {scenarioName:'Fixed periods and visible Economics overlap',termId:'SYNTHETIC',policy,
  courses:[{code:'اقصد-101',title:'مقدمة الاقتصاد',level:1,demand:20,theoryHours:3,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],assignedInstructorId:'2',blocks:['G::A']},
   {code:'MAIN',title:'Synthetic theory',level:1,demand:20,theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['G::A']}],
  instructors:[{id:'2',name:'Economics trainer',maxLoad:12,allowedModes:['ONSITE'],eligibleCourseCodes:['اقصد-101'],available:[{day:'SUN',from:10,to:12.5}]},
   {id:'OTHER',name:'Other trainer',maxLoad:24,allowedModes:['ONSITE'],eligibleCourseCodes:['MAIN'],available:[{day:'SUN',from:10,to:12}]}],
  rooms:[{id:'A',name:'Room A',type:'CLASSROOM',capacity:30},{id:'B',name:'Room B',type:'CLASSROOM',capacity:30}]};
}
test('regular and Economics meetings use exact minute periods and keep curriculum credits separate',()=>{
 const input=fixture(),result=buildDraftPlan(input);
 assert.equal(result.gaps.length,0);
 const eco=result.sessions.find(session=>session.courseCode==='اقصد-101')!,ordinary=result.sessions.find(session=>session.courseCode==='MAIN')!;
 assert.equal(formatClock(eco.start),'10:00');assert.equal(formatClock(eco.end),'12:30');assert.equal(eco.trainingHours,3);
 assert.equal(formatClock(ordinary.end),'11:40');assert.equal(ordinary.trainingHours,2);
 assert.equal(result.instructorLoads.find(load=>load.id==='2')!.contact,3);
 assert.equal(result.instructorLoads.find(load=>load.id==='2')!.clockHours,2.5);
 assert.ok(result.sessions.every(session=>validPeriodSession(session,input.policy)));
 assert.equal(formatClock(580/60),'09:40');assert.equal(formatClock(820/60),'13:40');
});
test('only verified cohort overlaps involving Economics are warnings; rooms and trainers still block',()=>{
 const input=fixture(),result=buildDraftPlan(input),readiness=assessReadiness(input,result,'COMPLETED');
 assert.equal(readiness.technicalReady,true);
 assert.equal(readiness.issues.filter(issue=>issue.code==='ECONOMICS_COHORT_OVERLAP').length,2);
 assert.ok(readiness.issues.filter(issue=>issue.code==='ECONOMICS_COHORT_OVERLAP').every(issue=>issue.severity==='WARNING'&&issue.message.includes('11:40')));
 const roomCollision=structuredClone(result);roomCollision.sessions[1]!.roomId=roomCollision.sessions[0]!.roomId;
 assert.ok(assessReadiness(input,roomCollision,'COMPLETED').issues.some(issue=>issue.code==='ROOM_OCCUPIED'&&issue.severity==='BLOCKER'));
 const trainerCollision=structuredClone(result);trainerCollision.sessions[1]!.instructorId='2';
 assert.ok(assessReadiness(input,trainerCollision,'COMPLETED').issues.some(issue=>issue.code==='TRAINER_COLLISION'&&issue.severity==='BLOCKER'));
 const ordinary=structuredClone(result);ordinary.sessions[0]!.courseCode='MAIN';
 assert.ok(assessReadiness(input,ordinary,'COMPLETED').issues.some(issue=>issue.code==='BLOCK_COLLISION'));
});
test('three-hour regular courses support either a 100+50-minute pattern or full-period occupancy',()=>{
 for(const partialPeriod of ['TRIM_END','FULL_PERIOD'] as const){
  const input=fixture();input.policy.lecturePeriods!.partialPeriod=partialPeriod;
  input.courses=input.courses.slice(1);input.courses[0]!.theoryHours=3;input.instructors=input.instructors.slice(1);delete input.instructors[0]!.available;
  const result=buildDraftPlan(input);assert.equal(result.gaps.length,0);
  assert.deepEqual(result.sessions.map(session=>session.trainingHours),[2,1]);
  assert.equal(Math.round(result.sessions.reduce((sum,session)=>sum+(session.end-session.start)*60,0)),partialPeriod==='TRIM_END'?150:200);
  assert.equal(result.sessions.reduce((sum,session)=>sum+trainingHours(session,input.policy),0),3);
  assert.equal(assessReadiness(input,result,'COMPLETED').technicalReady,true);
 }
});
test('manual moves can introduce a visible allowed Economics overlap but cannot leave prescribed periods',()=>{
 const input=fixture();delete input.instructors[1]!.available;
 const result=buildDraftPlan(input),meeting=result.sessions.find(session=>session.courseCode==='MAIN')!;
 assert.equal(formatClock(meeting.start),'08:00');
 const moved=moveScheduledSession(input,result,{sessionId:meeting.id,day:'SUN',start:10,roomId:'B',instructorId:'OTHER'});
 assert.ok(assessReadiness(input,moved,'COMPLETED').issues.some(issue=>issue.code==='ECONOMICS_COHORT_OVERLAP'));
 assert.throws(()=>moveScheduledSession(input,result,{sessionId:meeting.id,day:'SUN',start:8.5,roomId:'B',instructorId:'OTHER'}),/INVALID_TIME/);
});
test('fixed-period validation rejects fabricated credits and keeps legacy half-hour safeguards',()=>{
 const input=fixture(),result=buildDraftPlan(input),forged=structuredClone(result);
 forged.sessions.find(session=>session.courseCode==='MAIN')!.trainingHours=4;
 assert.ok(assessReadiness(input,forged,'COMPLETED').issues.some(issue=>issue.code==='INVALID_TIME'));
 const invalid=fixture();invalid.policy.lecturePeriods!.regular[0]!.endMinute=581;
 assert.throws(()=>validateRequest(invalid),/lecture-period/);
 const legacy=fixture();legacy.policy=defaultPolicy();legacy.policy.slots=[{day:'SUN',from:8.25,to:12}];
 assert.throws(()=>validateRequest(legacy),/Invalid time window/);
});
test('real Timefold schedules permitted Economics cohort overlaps with a zero hard score',async()=>{
 const input=fixture(),result=await optimizeWithTimefold(input,{seconds:1,candidatesPerInstructor:4});
 assert.equal(result.gaps.length,0);assert.equal(assessReadiness(input,result,'COMPLETED').technicalReady,true);
 assert.ok(assessReadiness(input,result,'COMPLETED').issues.some(issue=>issue.code==='ECONOMICS_COHORT_OVERLAP'));
 assert.ok(result.notices.some(notice=>notice.includes('hard=0')));
 const payload=prepareSolverPayload(input,2),choice=payload.tasks.find(task=>task.courseCode==='MAIN')!.choices.find(choice=>!choice.uncovered)!;
 choice.sessions[0]!.cohortOverlapWarning=true;
 assert.throws(()=>applySolverChoice(input,payload,{schemaVersion:payload.schemaVersion,hardScore:0,softScore:0,
  choices:payload.tasks.map(task=>({taskId:task.id,candidateId:task.choices.find(choice=>!choice.uncovered)!.id}))}),/Invalid fixed lecture period/);
});
