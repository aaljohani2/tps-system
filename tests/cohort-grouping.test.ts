import test from 'node:test';
import assert from 'node:assert/strict';
import {packTheoryBlocks,hasSharedBlock} from '../src/cohort-grouping.js';
import {validateRequest} from '../src/validation.js';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {assessReadiness} from '../src/api/readiness.js';
import type {PlanRequest} from '../src/types.js';

test('combined theory groups use capacity while preserving every practical base block',()=>{
  const base=[40,40,40,40,5].map((size,index)=>({
    ref:'LEVEL1::B'+String(index+1).padStart(2,'0'),size}));
  const packed=packTheoryBlocks(base,100);
  assert.equal(packed.length,2,'165 trainees fit into two theory sections of <=100 without splitting blocks');
  assert.equal(packed.reduce((total,x)=>total+x.size,0),165);
  assert.ok(packed.every(x=>x.size<=100));
  assert.deepEqual(packed.flatMap(x=>x.members).sort(),base.map(x=>x.ref).sort());
  assert.equal(new Set(packed.flatMap(x=>x.members)).size,base.length);
  const grouped={blockId:packed[0]!.members.join(' + '),blockIds:packed[0]!.members};
  const shared={blockId:packed[0]!.members[0]!};
  const disjoint={blockId:packed[1]!.members[0]!};
  assert.equal(hasSharedBlock(grouped,shared),true,
    'A theory lecture collides with practical session of any constituent block');
  assert.equal(hasSharedBlock(grouped,disjoint),false);
  assert.equal(hasSharedBlock({blockId:null},{blockId:null}),false);
});
test('packing cannot invent capacity, duplicate a student block or mix unrelated cohorts',()=>{
  assert.throws(()=>packTheoryBlocks([{ref:'C::B1',size:80}],40),/oversized/);
  assert.throws(()=>packTheoryBlocks([{ref:'C::B1',size:10},{ref:'C::B1',size:10}],40),/Duplicate/);
  const cohorts=packTheoryBlocks([{ref:'C1::B1',size:15},{ref:'C2::B1',size:15}],40);
  assert.equal(cohorts.length,2,'Different cohorts must never be silently coalesced');
});
test('validated group identities cannot be replaced with inconsistent or repeated memberships',()=>{
  const policy=defaultPolicy();
  const base={code:'THE-1',title:'Theory only',level:1,demand:35,theoryHours:2,practicalHours:0,
    mode:'ONSITE' as const,eligibleModes:['ONSITE' as const],
    blocks:['G::B01 + G::B02'],blockSizes:[35],blockGroups:[['G::B01','G::B02']]};
  const input={scenarioName:'Merged group',termId:'T',courses:[base],instructors:[],rooms:[],policy};
  assert.doesNotThrow(()=>validateRequest(input));
  assert.throws(()=>validateRequest({...input,courses:[{...base,blockGroups:[['G::B01','G::B01']]}]}),
    /duplicated grouped cohort identities/);
  assert.throws(()=>validateRequest({...input,courses:[{...base,practicalHours:1}]}),
    /Cannot combine groups for practical/);
});

test('readiness blocks a merged lecture overlapping a practical member, even with different display IDs',()=>{
  const policy=defaultPolicy();
  const input:PlanRequest={
    scenarioName:'Merged collision',termId:'SYNTHETIC',
    policy,
    courses:[
      {code:'LECT',title:'Theory',level:1,demand:35,theoryHours:2,practicalHours:0,
        mode:'ONSITE',eligibleModes:['ONSITE'],
        blocks:['COHORT::B01 + COHORT::B02'],blockSizes:[35],
        blockGroups:[['COHORT::B01','COHORT::B02']]},
      {code:'LAB',title:'Lab',level:1,demand:20,theoryHours:0,practicalHours:2,
        mode:'ONSITE',eligibleModes:['ONSITE'],
        blocks:['COHORT::B02'],blockSizes:[20]}
    ],
    instructors:[
      {id:'T-LECT',name:'Theory trainer',maxLoad:20,allowedModes:['ONSITE'],
        eligibleCourseCodes:['LECT']},
      {id:'T-LAB',name:'Practical trainer',maxLoad:20,allowedModes:['ONSITE'],
        eligibleCourseCodes:['LAB']}
    ],
    rooms:[
      {id:'R-LECT',name:'Lecture',type:'CLASSROOM',capacity:50},
      {id:'R-LAB',name:'Lab',type:'LAB',capacity:30}
    ]
  };
  const result=buildDraftPlan(input);
  const lecture=result.sessions.find(s=>s.courseCode==='LECT');
  const lab=result.sessions.find(s=>s.courseCode==='LAB');
  assert.ok(lecture&&lab,'Both independent meetings should be feasible at distinct times');
  lab.day=lecture.day;lab.start=lecture.start;lab.end=lecture.end;
  assert.notEqual(lab.instructorId,lecture.instructorId);
  assert.notEqual(lab.roomId,lecture.roomId);
  const readiness=assessReadiness(input,result,'COMPLETED');
  assert.ok(readiness.issues.some(x=>x.code==='BLOCK_COLLISION'),
    'Readiness must block shared learner membership despite different group labels');
  assert.equal(readiness.technicalReady,false);
});
