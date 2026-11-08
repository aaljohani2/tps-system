import test from 'node:test';import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';import {createCapacityProjection,projectionProfiles} from '../src/capacity-projections.js';
import {splitTeachingSections} from '../src/load-targets.js';import {buildDraftPlan} from '../src/planner.js';import type {PlanRequest} from '../src/types.js';
import {optimizeWithTimefold} from '../src/optimizer.js';
test('24-hour targets pack complete three/four-hour sections for two trainers without increasing staffing limits',async()=>{
 const input:PlanRequest={scenarioName:'Exact load packing',termId:'TEST',policy:defaultPolicy(),
  courses:[...Array(6).fill(4),...Array(8).fill(3)].map((hours,index)=>({code:'C'+index,title:'Theory '+index,level:1,demand:20,theoryHours:hours,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['G'+index]})),
  instructors:['5','6'].map(id=>({id,name:id,maxLoad:24,allowedModes:['ONSITE'],teachingRules:{preferredCreditedLoad:24,allowedCourseTypes:['THEORY','MIXED']}})),
  rooms:[{id:'R1',name:'R1',type:'CLASSROOM',capacity:30},{id:'R2',name:'R2',type:'CLASSROOM',capacity:30}]};
 const before=structuredClone(input),preview=buildDraftPlan(input);assert.deepEqual(preview.instructorLoads.map(load=>load.credited),[24,24]);
 const result=await optimizeWithTimefold(input,{seconds:1,candidatesPerInstructor:3});
 assert.equal(result.gaps.length,0);assert.deepEqual(result.instructorLoads.map(load=>load.credited),[24,24]);assert.deepEqual(input,before);
});
test('authorized splits add nine real teaching hours without changing population, maximum capacities or external demand',()=>{
 const base:PlanRequest={scenarioName:'Synthetic',termId:'TEST',policy:defaultPolicy(),instructors:[],rooms:[],courses:[
  {code:'ECO',title:'مقدمة في الاقتصاد',level:1,theoryHours:3,practicalHours:0},
  {code:'TOPIC',title:'موضوعات مختارة',level:4,theoryHours:3,practicalHours:0},
  {code:'ENT',title:'ريادة الإدارة',level:3,theoryHours:1,practicalHours:2},
  {code:'TIME',title:'إدارة الوقت',level:4,theoryHours:3,practicalHours:0},
  {code:'EXT',title:'General',level:4,theoryHours:3,practicalHours:0,assignmentScope:'EXTERNAL' as const,externalSectionCapacity:40}
 ].map(course=>({...course,demand:0,mode:'ONSITE',eligibleModes:['ONSITE']}))};
 const source=createCapacityProjection(base,projectionProfiles[2],{1:157,2:187,3:110,4:93,5:38}),before=structuredClone(source);
 const input=splitTeachingSections(source,['TOPIC','ENT','TIME']),old=buildDraftPlan(source),result=buildDraftPlan(input);
 assert.deepEqual(source,before);assert.equal(result.metrics.requiredContactHours-old.metrics.requiredContactHours,9);
 assert.equal(result.sections.length-old.sections.length,3);
 assert.deepEqual(input.courses.map(c=>[c.code,c.demand,c.theoryHours,c.practicalHours,c.sectionCapacity]),source.courses.map(c=>[c.code,c.demand,c.theoryHours,c.practicalHours,c.sectionCapacity]));
 for(const code of ['TOPIC','ENT','TIME']){const course=input.courses.find(c=>c.code===code)!;assert.equal(course.blockSizes!.length,2);assert.equal(course.blockSizes!.reduce((a,b)=>a+b,0),course.demand);assert.equal(course.sectionCapacity,120);}
 assert.deepEqual(result.externalSections?.map(({blockIds,...section})=>section),old.externalSections?.map(({blockIds,...section})=>section));
 for(const level of [1,2,3,4])assert.equal(input.cohortBlocks!.filter(b=>b.level===level).reduce((n,b)=>n+b.size,0),source.cohortBlocks!.filter(b=>b.level===level).reduce((n,b)=>n+b.size,0));
 assert.throws(()=>splitTeachingSections(input,['TOPIC']),/one verified internal section/);
 assert.throws(()=>splitTeachingSections(source,['EXT']),/one verified internal section/);
});
