import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {defaultPolicy} from '../src/policy.js';
import {applyCourseCapacityException} from '../src/course-capacity-exception.js';
import {applyExternalAssignments} from '../src/external-assignment.js';
import {buildDraftPlan} from '../src/planner.js';
import {prepareSolverPayload,optimizeWithTimefold} from '../src/optimizer.js';
import {assessReadiness} from '../src/api/readiness.js';
import {createCapacityProjection,projectionProfiles} from '../src/capacity-projections.js';
import {renderPrintableScenario} from '../src/print-report.js';
import type {PlanRequest} from '../src/types.js';

function fixture():PlanRequest{
 const courses=[
  {code:'ECO',title:'مقدمة في الاقتصاد',theoryHours:3,practicalHours:0},
  {code:'OWN',title:'مقرر تخصصي',theoryHours:2,practicalHours:2},
  {code:'GENERAL-T',title:'لغة عامة',theoryHours:3,practicalHours:0},
  {code:'GENERAL-P',title:'مقدمة تطبيقات الحاسب',theoryHours:0,practicalHours:4}
 ];
 const source:PlanRequest={scenarioName:'External department ownership',termId:'TEST',policy:defaultPolicy(),
  courses:courses.map(course=>({...course,level:1,demand:157,mode:'ONSITE',eligibleModes:['ONSITE'],
   blocks:Array.from({length:6},(_,i)=>'L1::B'+i),blockSizes:[30,30,30,30,30,7]})),
  instructors:[{id:'LOCAL',name:'Department trainer',maxLoad:100,allowedModes:['ONSITE'],eligibleCourseCodes:['ECO','OWN']}],
  rooms:[{id:'THEORY',name:'Classroom',type:'CLASSROOM',capacity:200},{id:'LAB',name:'Lab',type:'LAB',capacity:200}]};
 return applyCourseCapacityException(source,'ECO',50);
}
const definitions=[{code:'GENERAL-T',capacity:40},{code:'GENERAL-P',capacity:40}];
test('external theory and practical courses retain exact 40-seat demand outside department load and gaps',()=>{
 const source=fixture(),original=structuredClone(source),input=applyExternalAssignments(source,definitions),result=buildDraftPlan(input);
 assert.deepEqual(source,original);
 assert.equal(result.sections.length,10);assert.equal(result.externalSections?.length,8);
 for(const code of ['GENERAL-T','GENERAL-P']){
  assert.deepEqual(result.externalSections?.filter(section=>section.courseCode===code).map(section=>section.students),[40,40,40,37]);
  assert.ok(!result.sections.some(section=>section.courseCode===code));assert.ok(!result.gaps.some(gap=>gap.courseCode===code));
  assert.ok(!result.sessions.some(session=>session.courseCode===code));
 }
 assert.equal(result.metrics.requiredContactHours,36);
 assert.equal(result.instructorLoads[0]?.credited,36);assert.equal(result.gaps.length,0);
 const readiness=assessReadiness(input,result,'COMPLETED');assert.equal(readiness.technicalReady,true);
 assert.ok(readiness.issues.some(issue=>issue.code==='EXTERNAL_ASSIGNMENT_PENDING'&&issue.severity==='WARNING'));
 assert.equal(readiness.byCourse.length,2);
 const payload=prepareSolverPayload(input,2);assert.equal(payload.tasks.length,10);
 assert.ok(payload.tasks.every(task=>['ECO','OWN'].includes(task.courseCode)));
});
test('every capacity profile retains external groups at 40 and Economics at 50',()=>{
 const base=applyExternalAssignments(fixture(),definitions);
 for(const profile of projectionProfiles){
  const input=createCapacityProjection(base,profile,{1:157,2:187,3:110,4:93,5:38});
  assert.equal(input.projection?.rules.economics,50);
  const result=buildDraftPlan(input);assert.equal(result.externalSections?.length,8);
  assert.ok(result.externalSections?.every(section=>section.capacity===40));
  assert.ok(result.sections.filter(section=>section.courseCode==='ECO').every(section=>section.capacity===50));
 }
});
test('external demand without cohort evidence stays pending without fabricating student membership',()=>{
 const source=fixture();for(const course of source.courses){delete course.blocks;delete course.blockSizes;delete course.blockGroups;}
 delete source.cohortBlocks;
 const result=buildDraftPlan(applyExternalAssignments(source,definitions));
 assert.equal(result.externalSections?.length,8);assert.ok(result.externalSections?.every(section=>!section.blockIds.length));
});
test('readiness detects accidental external entries in department shortages and printable output separates them',()=>{
 const input=applyExternalAssignments(fixture(),definitions),result=buildDraftPlan(input);
 result.gaps.push({sectionId:'BAD',courseCode:'GENERAL-T',level:1,students:40,contactHours:3,equivalentLoad:3,reason:'NO_ELIGIBLE_INSTRUCTOR'});
 assert.ok(assessReadiness(input,result,'COMPLETED').issues.some(issue=>issue.code==='EXTERNAL_IN_DEPARTMENT_RESULT'));
 result.gaps=[];
 const html=renderPrintableScenario({name:'External test',state:'DRAFT',termId:'T',policyRevision:1,result,issues:[]});
 assert.match(html,/مقررات عامة بإسناد خارجي/);assert.match(html,/بانتظار إسناد خارجي/);
});
test('real Timefold only schedules internal teaching while preserving the external handoff roster',
 {skip:!existsSync('solver/target/tps-timefold-0.2.0-jar-with-dependencies.jar')},async()=>{
 const input=applyExternalAssignments(fixture(),definitions);
 const result=await optimizeWithTimefold(input,{seconds:1,candidatesPerInstructor:2});
 assert.equal(result.externalSections?.length,8);assert.equal(result.sections.length,10);
 assert.ok(result.gaps.every(gap=>['ECO','OWN'].includes(gap.courseCode)));
 assert.ok(result.sessions.every(session=>['ECO','OWN'].includes(session.courseCode)));
 assert.equal(result.metrics.requiredContactHours,36);
});
