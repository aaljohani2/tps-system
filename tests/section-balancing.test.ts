import test from 'node:test';import assert from 'node:assert/strict';
import {balancedSectionSizes,rebalanceSecondScenario} from '../src/section-balancing.js';
import {createCapacityProjection,projectionProfiles} from '../src/capacity-projections.js';
import {applyCourseCapacityException} from '../src/course-capacity-exception.js';
import {defaultPolicy} from '../src/policy.js';import {validateRequest} from '../src/validation.js';
import {hasSharedBlock} from '../src/cohort-grouping.js';import type {PlanRequest} from '../src/types.js';
function fixture():PlanRequest{
 return {scenarioName:'Synthetic balancing',termId:'TEST',policy:defaultPolicy(),instructors:[],rooms:[],courses:[
  {code:'ECO',title:'مقدمة في الاقتصاد',level:2,theoryHours:3,practicalHours:0},
  {code:'THE',title:'نظرية تخصصية',level:1,theoryHours:4,practicalHours:0},
  {code:'THE3',title:'نظرية مستوى 3',level:3,theoryHours:3,practicalHours:0},
  {code:'MIX',title:'مختلط',level:1,theoryHours:2,practicalHours:2},
  {code:'MIX3',title:'مختلط مستوى 3',level:3,theoryHours:1,practicalHours:2},
  {code:'PR',title:'عملي بحت',level:1,theoryHours:0,practicalHours:4},
  {code:'EXT',title:'عامة خارجية',level:1,theoryHours:3,practicalHours:0,assignmentScope:'EXTERNAL' as const,externalSectionCapacity:40}
 ].map(course=>({...course,demand:1,mode:'ONSITE',eligibleModes:['ONSITE']}))};
}
const counts={1:157,2:187,3:110,4:93,5:38};
test('balanced integer sections match the requested tens examples and retain hard capacity bounds',()=>{
 assert.deepEqual(balancedSectionSizes(157,50),[40,40,40,37]);
 assert.deepEqual(balancedSectionSizes(157,100),[80,77]);
 assert.deepEqual(balancedSectionSizes(110,100),[60,50]);
 assert.deepEqual(balancedSectionSizes(187,50),[50,50,40,47]);
 assert.deepEqual(balancedSectionSizes(87,26),[20,20,24,23]);
 assert.deepEqual(balancedSectionSizes(7,100),[7],'A whole course with seven trainees cannot lose its students');
 assert.deepEqual(balancedSectionSizes(0,40),[]);
 for(const total of [1,7,10,11,19,20,57,93,101,110,157,187,499,7500])for(const cap of [8,17,26,30,40,50,100,120,5000]){
  const sizes=balancedSectionSizes(total,cap);assert.equal(sizes.reduce((n,s)=>n+s,0),total);assert.equal(sizes.length,Math.ceil(total/cap));
  assert.ok(sizes.every(size=>Number.isInteger(size)&&size>0&&size<=cap));
  if(total>=10*sizes.length)assert.ok(sizes.every(size=>size>=10));
 }
 assert.throws(()=>balancedSectionSizes(3.5,50),/Invalid/);assert.throws(()=>balancedSectionSizes(157,0),/Invalid/);
});
test('scenario two generation balances theory and tiny internal groups without changing either other profile',()=>{
 const original=fixture(),before=structuredClone(original),second=createCapacityProjection(original,projectionProfiles[1],counts);
 const sizes=(code:string)=>second.courses.find(course=>course.code===code)!.blockSizes;
 assert.deepEqual(sizes('THE'),[80,77]);assert.deepEqual(sizes('THE3'),[60,50]);assert.deepEqual(sizes('MIX'),[40,40,40,37]);
 assert.deepEqual(sizes('MIX3'),[50,50,10]);assert.deepEqual(sizes('PR'),[40,40,40,37]);assert.deepEqual(sizes('EXT'),[40,40,40,37]);
 assert.equal(second.courses.find(c=>c.code==='ECO')!.sectionCapacity,50);
 for(const profile of [projectionProfiles[0],projectionProfiles[2]]){
  const input=createCapacityProjection(original,profile,counts),copy=structuredClone(input);assert.strictEqual(rebalanceSecondScenario(input),input);assert.deepEqual(input,copy);
 }
 assert.deepEqual(original,before);
});
test('regrouping an existing second snapshot preserves exact learner intersections, all populations and unrelated course sizes',()=>{
 let source=createCapacityProjection(fixture(),projectionProfiles[1],counts);
 for(const [code,capacity] of [['THE',100],['THE3',100],['MIX',50],['ECO',50]] as const)source=applyCourseCapacityException(source,code,capacity);
 const original=structuredClone(source),input=rebalanceSecondScenario(source);assert.deepEqual(source,original);assert.doesNotThrow(()=>validateRequest(input));
 assert.deepEqual(rebalanceSecondScenario(input),input);
 assert.deepEqual(input.instructors,source.instructors);assert.deepEqual(input.rooms,source.rooms);assert.deepEqual(input.policy,source.policy);
 for(const course of input.courses){const old=source.courses.find(old=>old.code===course.code)!;
  for(const field of ['demand','level','theoryHours','practicalHours','sectionCapacity','assignmentScope'])assert.deepEqual(course[field as keyof typeof course],old[field as keyof typeof old]);
  if(['PR','EXT','MIX3'].includes(course.code))assert.deepEqual(course.blockSizes,old.blockSizes);
 }
 const ranges=(course:typeof input.courses[number])=>{let from=0;return course.blockSizes!.map((size,index)=>{const value={from,to:from+size,blockId:course.blocks![index]!,blockIds:course.blockGroups![index]};from+=size;return value;});};
 for(const a of input.courses)for(const b of input.courses.filter(b=>b.level===a.level))for(const first of ranges(a))for(const second of ranges(b))
  assert.equal(hasSharedBlock(first,second),Math.max(first.from,second.from)<Math.min(first.to,second.to),a.code+'/'+b.code);
 for(const level of [1,2,3,4])assert.equal(input.cohortBlocks!.filter(b=>b.level===level).reduce((n,b)=>n+b.size,0),counts[level as keyof typeof counts]);
});
