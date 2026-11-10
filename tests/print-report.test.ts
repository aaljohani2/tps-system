import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {renderPrintableScenario} from '../src/print-report.js';
import type {PlanRequest} from '../src/types.js';

test('printable Arabic report escapes injected markup and includes real scenario metrics',()=>{
  const input:PlanRequest={scenarioName:'<script>alert(1)</script>',termId:'TERM',
    policy:defaultPolicy(),
    courses:[{code:'C-1',title:'Synthetic',level:1,demand:22,theoryHours:2,
      practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['B1']}],
    instructors:[{id:'I1',name:'Trainer',allowedModes:['ONSITE'],maxLoad:18}],
    rooms:[{id:'R1',name:'Room',type:'CLASSROOM',capacity:30}]};
  const plan=buildDraftPlan(input);
  const report=renderPrintableScenario({
    name:input.scenarioName,state:'DRAFT',termId:'TERM',policyRevision:2,result:plan,
    issues:[{code:'ROOM_OCCUPIED',severity:'BLOCKER',message:'<img src=x onerror=alert(1)>',
      sectionId:'C-1-001',courseCode:'C-1'}]});
  assert.ok(report.includes('lang="ar" dir="rtl"'));
  assert.ok(report.includes('حفظ PDF'));
  assert.ok(report.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(report.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(report.includes('<script>alert(1)</script>'),false);
  assert.equal(report.includes('<img src=x onerror=alert(1)>'),false);
  assert.ok(report.includes('ساعات الاتصال'));
  assert.ok(report.includes('حالة السيناريو'));
});
