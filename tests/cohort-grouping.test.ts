import test from 'node:test';
import assert from 'node:assert/strict';
import {packTheoryBlocks,hasSharedBlock} from '../src/cohort-grouping.js';
import {validateRequest} from '../src/validation.js';
import {defaultPolicy} from '../src/policy.js';

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
