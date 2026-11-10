import test from 'node:test';
import assert from 'node:assert/strict';
import {createCapacityProjection,projectionProfiles} from '../src/capacity-projections.js';
import {buildDraftPlan} from '../src/planner.js';
import {defaultPolicy} from '../src/policy.js';
import {validateRequest} from '../src/validation.js';
import {hasSharedBlock} from '../src/cohort-grouping.js';
import {assessReadiness} from '../src/api/readiness.js';
import type {PlanRequest} from '../src/types.js';
import {existsSync} from 'node:fs';
import {optimizeWithTimefold} from '../src/optimizer.js';
import {applyCourseCapacityException} from '../src/course-capacity-exception.js';

const counts={1:157,2:187,3:110,4:93,5:38};
function base():PlanRequest{
  return {scenarioName:'Original',termId:'REF',policy:defaultPolicy(),instructors:[],rooms:[],courses:[
    {code:'ECO-1',title:'مقدمة في الاقتصاد',level:1,demand:1,theoryHours:3,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE']},
    {code:'THE-1',title:'نظرية',level:1,demand:1,theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE']},
    {code:'MIX-1',title:'مختلط',level:1,demand:1,theoryHours:2,practicalHours:2,mode:'ONSITE',eligibleModes:['ONSITE']},
    {code:'PR-1',title:'عملي',level:1,demand:1,theoryHours:0,practicalHours:2,mode:'ONSITE',eligibleModes:['ONSITE']},
    {code:'PROJ',title:'المشروع الإنتاجي',level:5,demand:1,theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE']}
  ]};
}
test('three capacity projections preserve the source snapshot, exclude the project and retain cooperative demand',()=>{
 const original=base(),saved=structuredClone(original);
 for(const profile of projectionProfiles){
  const input=createCapacityProjection(original,profile,counts);
  assert.equal(input.projection?.cooperativeStudents,38);assert.equal(input.projection?.cooperativeAdministrativeBlocks,2);
  assert.ok(!input.courses.some(course=>course.code==='PROJ'));
  assert.ok(input.courses.every(course=>course.demand===157));
  assert.doesNotThrow(()=>validateRequest(input));
 }
 assert.deepEqual(original,saved);
});
test('requested capacities generate exact course populations including the economics exception',()=>{
 const result=(index:number)=>buildDraftPlan(createCapacityProjection(base(),projectionProfiles[index]!,counts));
 const first=result(0),second=result(1),third=result(2);
 const sizes=(r:typeof second,code:string)=>r.sections.filter(section=>section.courseCode===code).map(section=>section.students);
 assert.deepEqual(sizes(second,'THE-1'),[80,77]);assert.deepEqual(sizes(second,'MIX-1'),[40,40,40,37]);
 assert.deepEqual(sizes(second,'PR-1'),[40,40,40,37]);
 assert.deepEqual(sizes(third,'THE-1'),[120,37]);assert.deepEqual(sizes(third,'MIX-1'),[120,37]);
 assert.deepEqual(sizes(third,'PR-1'),[40,40,40,37]);assert.deepEqual(sizes(third,'ECO-1'),[50,50,50,7]);
 for(const scenario of [first,second,third]){
  assert.deepEqual(sizes(scenario,'ECO-1'),scenario===second?[40,40,40,37]:[50,50,50,7]);
  assert.ok(scenario.sections.filter(section=>section.courseCode==='ECO-1').every(section=>section.capacity===50));
 }
 assert.ok(third.sections.filter(section=>section.courseCode==='ECO-1').every(section=>section.capacity===50));
});
test('different practical and mixed class sizes share exact anonymous memberships for collision checks',()=>{
 const input=createCapacityProjection(base(),projectionProfiles[1],counts),result=buildDraftPlan(input);
 const mixed=result.sections.find(section=>section.courseCode==='MIX-1'&&section.index===1)!;
 const practical=result.sections.filter(section=>section.courseCode==='PR-1');
 assert.equal(hasSharedBlock(mixed,practical[0]!),true);
 assert.equal(hasSharedBlock(mixed,practical[1]!),false,'Balanced mixed section ends at 40, where the next practical section starts');
 assert.equal(hasSharedBlock(result.sections.find(section=>section.courseCode==='MIX-1'&&section.index===2)!,practical[1]!),true);
 assert.equal(hasSharedBlock(mixed,practical[2]!),false);
 const broken=structuredClone(input);broken.courses[0]!.blockSizes![0]!--;
 assert.throws(()=>validateRequest(broken),/exact demand|membership/);
 const forged=structuredClone(input);forged.cohortBlocks![0]!.size++;
 assert.throws(()=>validateRequest(forged),/membership/);
});
test('baseline retains the previous 30-trainee blocks and capacity-safe theory packing',()=>{
 const input=createCapacityProjection(base(),projectionProfiles[0],counts);
 assert.equal(input.projection?.baseBlocksByLevel[1],6);
 const result=buildDraftPlan(input);
 assert.deepEqual(result.sections.filter(section=>section.courseCode==='PR-1').map(section=>section.students),[30,30,30,30,30,7]);
 assert.equal(result.sections.filter(section=>section.courseCode==='THE-1').length,5);
});
test('course-specific capacity remains a guard in validation and independent readiness',()=>{
 const input=createCapacityProjection(base(),projectionProfiles[2],counts);
 input.courses.find(course=>course.code==='ECO-1')!.sectionCapacity=0;
 assert.throws(()=>validateRequest(input),/scenario section capacity/);
 const valid=createCapacityProjection(base(),projectionProfiles[2],counts),result=buildDraftPlan(valid);
 result.sections.find(section=>section.courseCode==='ECO-1')!.students=51;
 assert.ok(assessReadiness(valid,result,'COMPLETED').issues.some(issue=>issue.code==='SECTION_CAPACITY'));
});
test('real Timefold preserves Arabic course and cohort identities on Windows stdio',
 {skip:!existsSync('solver/target/tps-timefold-0.2.0-jar-with-dependencies.jar')},async()=>{
  const source=base();source.courses=source.courses.filter(c=>c.code==='ECO-1');
  source.courses[0]!.code='ادار-١٠١';
  const input=createCapacityProjection(source,projectionProfiles[1],counts);
  const result=await optimizeWithTimefold(input,{seconds:1,candidatesPerInstructor:1});
  assert.equal(result.sections.length,4);
  assert.ok(result.sections.every(section=>section.courseCode==='ادار-١٠١'));
  assert.equal(result.gaps.length,4,'No rooms or trainers must stay explicit uncovered work');
  assert.ok(result.notices.some(notice=>notice.includes('Timefold')));
 });
test('applying a 50-seat exception to legacy 30-seat cohorts preserves all other section sizes',()=>{
 const source=base();source.courses=source.courses.filter(c=>['ECO-1','PR-1'].includes(c.code));
 for(const course of source.courses){course.demand=157;course.blocks=['L1::B1','L1::B2','L1::B3','L1::B4','L1::B5','L1::B6'];course.blockSizes=[30,30,30,30,30,7];}
 const before=structuredClone(source),input=applyCourseCapacityException(source,'ECO-1',50),result=buildDraftPlan(input);
 assert.deepEqual(source,before);
 assert.deepEqual(result.sections.filter(s=>s.courseCode==='ECO-1').map(s=>s.students),[50,50,50,7]);
 assert.deepEqual(result.sections.filter(s=>s.courseCode==='PR-1').map(s=>s.students),[30,30,30,30,30,7]);
 assert.equal(input.policy.capacities.ONSITE.theory,45,'The general theory policy remains unchanged');
 assert.equal(input.policy.courseSectionCapacities?.['ECO-1'],50);
 assert.deepEqual(applyCourseCapacityException(input,'ECO-1',50),input,'Repeated application does not repartition again');
 const eco=result.sections.find(s=>s.courseCode==='ECO-1')!,practical=result.sections.filter(s=>s.courseCode==='PR-1');
 assert.equal(hasSharedBlock(eco,practical[0]!),true);assert.equal(hasSharedBlock(eco,practical[1]!),true);
 assert.equal(hasSharedBlock(eco,practical[2]!),false);
 const wide=applyCourseCapacityException(input,'ECO-1',100);
 assert.deepEqual(wide.courses.find(c=>c.code==='ECO-1')?.blockSizes,[100,57]);
 const reduced=applyCourseCapacityException(wide,'ECO-1',50);
 assert.deepEqual(reduced.courses.find(c=>c.code==='ECO-1')?.blockSizes,[50,50,50,7]);
 assert.deepEqual(reduced.courses.find(c=>c.code==='PR-1')?.blockSizes,[30,30,30,30,30,7]);
});
