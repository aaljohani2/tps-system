import test from 'node:test';
import assert from 'node:assert/strict';
import type {PlanRequest} from '../src/types.js';
import {defaultPolicy} from '../src/policy.js';
import {withRequestedLecturePeriods} from '../src/lecture-periods.js';
import {buildDraftPlan} from '../src/planner.js';
import {prepareSolverPayload,optimizeWithTimefold} from '../src/optimizer.js';
import {assessReadiness} from '../src/api/readiness.js';
import {validateRequest} from '../src/validation.js';

function fixture():PlanRequest{
 const policy=withRequestedLecturePeriods(defaultPolicy(),'TRIM_END');
 policy.priorityCourseCodes=['ادار-285','رياد-262'];
 return {scenarioName:'Internal priority coverage',termId:'SYNTHETIC',policy,
  courses:[{code:'OTHER',title:'Other department course',level:1,theoryHours:4,practicalHours:0},
   {code:'ادار-285',title:'موضوعات مختارة',level:4,theoryHours:3,practicalHours:0},
   {code:'رياد-262',title:'ريادة الاعمال في مجال الإدارة',level:3,theoryHours:1,practicalHours:2}]
   .map(course=>({...course,demand:20,mode:'ONSITE',eligibleModes:['ONSITE'],assignmentScope:'DEPARTMENT'})),
  instructors:[{id:'5',name:'Internal trainer',maxLoad:6,allowedModes:['ONSITE']}],
  rooms:[{id:'R',name:'Theory room',type:'CLASSROOM',capacity:30},{id:'L',name:'Practical lab',type:'LAB',capacity:30}]};
}
test('priority internal coverage consumes real department load and never creates external assignments',()=>{
 const input=fixture(),original=structuredClone(input),result=buildDraftPlan(input);
 assert.deepEqual(input,original);assert.equal(result.externalSections?.length??0,0);
 assert.equal(result.instructorLoads[0]!.credited,6);
 assert.deepEqual(result.gaps.map(gap=>gap.courseCode),['OTHER']);
 assert.ok(result.sections.filter(section=>input.policy.priorityCourseCodes!.includes(section.courseCode)).every(section=>section.state==='SCHEDULED'));
 const payload=prepareSolverPayload(input,6);
 assert.equal(payload.tasks.filter(task=>task.priorityCoverage).length,2);
 assert.ok(!payload.tasks.find(task=>task.courseCode==='OTHER')!.priorityCoverage);
});
test('real Timefold favors internal priority courses under limited staffing while enforcing load limits',async()=>{
 const input=fixture(),result=await optimizeWithTimefold(input,{seconds:2,candidatesPerInstructor:8});
 assert.deepEqual(result.gaps.map(gap=>gap.courseCode),['OTHER']);
 assert.equal(result.instructorLoads[0]!.credited,6);
 assert.ok(!assessReadiness(input,result,'COMPLETED').issues.some(issue=>issue.code==='PRIORITY_COURSE_UNCOVERED'));
 input.instructors[0]!.maxLoad=0;
 const unavailable=await optimizeWithTimefold(input,{seconds:1,candidatesPerInstructor:2});
 assert.equal(unavailable.sessions.length,0);
 assert.equal(assessReadiness(input,unavailable,'COMPLETED').issues.filter(issue=>issue.code==='PRIORITY_COURSE_UNCOVERED').length,2);
});
test('conflicting ownership and malformed coverage priorities are rejected without hiding gaps',()=>{
 const input=fixture();input.courses[1]!.assignmentScope='EXTERNAL';
 assert.throws(()=>validateRequest(input),/Priority coverage requires department ownership/);
 input.courses[1]!.assignmentScope='DEPARTMENT';input.policy.priorityCourseCodes=['ادار-285','ادار-285'];
 assert.throws(()=>validateRequest(input),/Invalid priority course codes/);
});
