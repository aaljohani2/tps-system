import test from 'node:test';
import assert from 'node:assert/strict';
import type {PlanRequest,InstructorTeachingRules} from '../src/types.js';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {optimizeWithTimefold,prepareSolverPayload,applySolverChoice} from '../src/optimizer.js';
import {assessReadiness} from '../src/api/readiness.js';
import {moveScheduledSession} from '../src/manual-schedule.js';
import {validateRequest} from '../src/validation.js';
import {trainerQualified} from '../src/eligibility.js';

function fixture(rules:InstructorTeachingRules):PlanRequest{
 return {scenarioName:'Instructor contact and section limits',termId:'TEST',policy:defaultPolicy(),
  courses:[{code:'LAB',title:'Practical',level:1,demand:60,theoryHours:0,practicalHours:4,mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['A','B']}],
  instructors:[{id:'ONE',name:'Synthetic',maxLoad:100,allowedModes:['ONSITE'],teachingRules:rules}],
  rooms:[{id:'LAB',name:'Synthetic lab',type:'LAB',capacity:30}]};
}
test('credited targets fill preferred trainers while practical-only eligibility remains hard and shortages visible',async()=>{
 const input=fixture({allowedCourseTypes:['PRACTICAL']});
 input.courses.push({...input.courses[0]!,code:'THEORY',title:'Theory',demand:20,blocks:['C'],theoryHours:3,practicalHours:0});
 input.instructors.push({id:'TARGET',name:'Target trainer',maxLoad:3,allowedModes:['ONSITE'],teachingRules:{preferredCreditedLoad:3,allowedCourseTypes:['THEORY','MIXED']}});
 input.rooms.push({id:'THEORY',name:'Theory room',type:'CLASSROOM',capacity:30});
 const payload=prepareSolverPayload(input,4);
 assert.ok(payload.tasks.filter(task=>task.courseCode==='LAB').every(task=>task.choices.every(choice=>choice.instructorId!=='TARGET')));
 assert.ok(payload.tasks.find(task=>task.courseCode==='THEORY')!.choices.some(choice=>choice.preferredCreditedMilli===3000));
 const result=await optimizeWithTimefold(input,{seconds:1,candidatesPerInstructor:4});
 assert.equal(result.instructorLoads.find(load=>load.id==='TARGET')!.credited,3);
 assert.ok(!assessReadiness(input,result,'COMPLETED').issues.some(issue=>issue.code==='INSTRUCTOR_LOAD_TARGET'));
 input.instructors[1]!.maxLoad=24;input.instructors[1]!.teachingRules!.preferredCreditedLoad=24;
 assert.ok(assessReadiness(input,result,'COMPLETED').issues.some(issue=>issue.code==='INSTRUCTOR_LOAD_TARGET'&&issue.severity==='WARNING'));
 input.instructors[1]!.teachingRules!.preferredCreditedLoad=25;assert.throws(()=>validateRequest(input),/credited-load target/);
});
test('actual contact hours and section limits apply independently of weighted trainer load',()=>{
 const input=fixture({maxContactHours:6,maxSections:2});input.policy.onsitePracticalLoadFactor=0.5;
 const result=buildDraftPlan(input);
 assert.equal(result.sections.filter(s=>s.state==='SCHEDULED').length,1);
 assert.equal(result.instructorLoads[0]!.credited,2);assert.equal(result.instructorLoads[0]!.contact,4);
 const capped=fixture({maxContactHours:20,maxSections:1});assert.equal(buildDraftPlan(capped).gaps.length,1);
 const payload=prepareSolverPayload(input,2);
 assert.ok(payload.tasks.every(t=>t.choices.filter(c=>!c.uncovered).every(c=>c.contactLimitMilli===6000&&c.sectionLimit===2)));
});
test('course type restrictions and exact Economics ownership are enforced before generating candidates',()=>{
 const input=fixture({allowedCourseTypes:['PRACTICAL']});
 const economics={...input.courses[0]!,code:'ECO',theoryHours:3,practicalHours:0,assignedInstructorId:'TWO'};
 assert.equal(trainerQualified(input.instructors[0]!,economics),false);
 input.courses.push(economics);input.instructors.push({id:'TWO',name:'Synthetic two',maxLoad:12,allowedModes:['ONSITE'],eligibleCourseCodes:['ECO'],teachingRules:{maxContactHours:12}});
 const tasks=prepareSolverPayload(input,1).tasks;
 assert.ok(tasks.filter(t=>t.courseCode==='ECO').every(t=>t.choices.filter(c=>!c.uncovered).every(c=>c.instructorId==='TWO')));
 assert.ok(tasks.filter(t=>t.courseCode==='LAB').every(t=>t.choices.filter(c=>!c.uncovered).every(c=>c.instructorId==='ONE')));
});
test('preferred practical types steer greedy placement and are represented in actual Timefold scores',()=>{
 const input=fixture({preferredCourseTypes:['PRACTICAL']});
 input.instructors.unshift({id:'OTHER',name:'Higher weighted capacity',maxLoad:200,allowedModes:['ONSITE'],teachingRules:{preferredCourseTypes:['THEORY','MIXED']}});
 const result=buildDraftPlan(input);assert.ok(result.sections.every(s=>s.instructorId==='ONE'));
 const choices=prepareSolverPayload(input,1).tasks[0]!.choices;
 assert.equal(choices.find(c=>c.instructorId==='ONE')!.preferenceScore,20);
 assert.equal(choices.find(c=>c.instructorId==='OTHER')!.preferenceScore,undefined);
});
test('readiness and manual reassignment cannot bypass trainer timetable limits',()=>{
 const input=fixture({maxContactHours:4,maxSections:1});
 input.instructors.push({id:'OTHER',name:'Second',maxLoad:100,allowedModes:['ONSITE']});
 const result=buildDraftPlan(input),other=result.sections.find(s=>s.instructorId==='OTHER')!;
 assert.ok(other);const session=result.sessions.find(s=>s.sectionId===other.id)!;
 assert.throws(()=>moveScheduledSession(input,result,{sessionId:session.id,day:session.day,start:session.start,roomId:session.roomId,instructorId:'ONE'}),/INSTRUCTOR_TEACHING_LIMIT|blocker/);
 const forged=structuredClone(result);for(const section of forged.sections)section.instructorId='ONE';
 assert.ok(assessReadiness(input,forged,'COMPLETED').issues.some(i=>i.code==='INSTRUCTOR_TEACHING_LIMIT'&&i.instructorId==='ONE'));
 const payload=prepareSolverPayload(input,6);
 assert.throws(()=>applySolverChoice(input,payload,{schemaVersion:payload.schemaVersion,hardScore:0,softScore:0,
  choices:payload.tasks.map((t,index)=>({taskId:t.id,candidateId:t.choices.find(c=>c.instructorId==='ONE'&&c.sessions.every(s=>s.day===(index?'MON':'SUN')))!.id}))}),/timetable\/section limit/);
});
test('invalid trainer rules fail before scheduling and unmet section targets remain visible',()=>{
 assert.throws(()=>validateRequest(fixture({maxSections:1,preferredSections:2})),/Preferred sections exceed/);
 assert.throws(()=>validateRequest(fixture({maxContactHours:-1})),/contact limit/);
 const input=fixture({maxContactHours:6,maxSections:2,preferredSections:2});
 assert.ok(assessReadiness(input,buildDraftPlan(input),'COMPLETED').issues.some(i=>i.code==='INSTRUCTOR_SECTION_TARGET'&&i.severity==='WARNING'));
});
test('real Timefold respects six actual hours even when weighted practical load is discounted',async()=>{
 const input=fixture({maxContactHours:6,maxSections:2,preferredSections:2});input.policy.onsitePracticalLoadFactor=0.5;
 const result=await optimizeWithTimefold(input,{seconds:1,candidatesPerInstructor:4});
 assert.equal(result.sections.filter(s=>s.state==='SCHEDULED').length,1);
 assert.equal(result.instructorLoads[0]!.contact,4);
 assert.ok(!assessReadiness(input,result,'COMPLETED').issues.some(i=>i.code==='INSTRUCTOR_TEACHING_LIMIT'));
});
test('a feasible priority preview seeds actual Timefold and stays within the requested candidate count',async()=>{
 const input=fixture({maxContactHours:8,maxSections:2,preferredSections:2,allowedCourseTypes:['PRACTICAL']});
 const payload=prepareSolverPayload(input,2);
 assert.ok(payload.tasks.every(task=>task.initialCandidateId&&task.choices.some(choice=>choice.id===task.initialCandidateId)));
 assert.ok(payload.tasks.every(task=>task.choices.filter(choice=>choice.instructorId==='ONE').length<=2));
 const result=await optimizeWithTimefold(input,{seconds:1,candidatesPerInstructor:2});
 assert.equal(result.instructorLoads[0]!.contact,8);assert.equal(result.gaps.length,0);
 assert.ok(result.notices.some(notice=>notice.includes('Timefold')));
 assert.ok(!result.notices.some(notice=>notice.includes('greedy draft')));
});
