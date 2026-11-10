import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateFixedGeneralStage,fixedGeneralStageResult,type FixedGeneralStage} from '../src/fixed-general-stage.js';
import {defaultPolicy} from '../src/policy.js';
import {validateRequest} from '../src/validation.js';
import {assessReadiness} from '../src/api/readiness.js';
const stage=():FixedGeneralStage=>({version:1,phase:'GENERAL_TIMES_ONLY',source:{file:'source.xlsx',sha256:'a'.repeat(64),sheet:'السجل الموحد',receivedAt:'2026-11-10'},
 rows:[{id:'A',level:2,section:2,title:'إحصاء',originalTitle:'إحصاء',day:'SUN',period:'مسائية',startMinute:1080,endMinute:1180,mode:'UNSPECIFIED',timingEvidence:'source',courseEvidence:'source',sourceLabel:'source',sourceRow:2}]});
test('fixed source preserves exact evening and unspecified mode without starting department planning',()=>{
 const input={scenarioName:'Stage 1',termId:'T',courses:[],instructors:[],rooms:[],policy:defaultPolicy(),fixedGeneralStage:stage()};
 validateRequest(input);const result=fixedGeneralStageResult(input);
 assert.equal(input.fixedGeneralStage.rows[0]!.startMinute,1080);
 assert.equal(input.fixedGeneralStage.rows[0]!.mode,'UNSPECIFIED');
 assert.deepEqual(result.sessions,[]);assert.deepEqual(result.sections,[]);assert.deepEqual(result.instructorLoads,[]);
 assert.ok(assessReadiness(input,result,'NOT_RUN').issues.some(i=>i.code==='GENERAL_STAGE_ONLY'));
 assert.throws(()=>validateRequest({...input,cohortBlocks:[{ref:'B',level:2,size:40}]}),/cannot contain department/);
});
test('fixed source rejects duplicate identity, invalid times and within-section overlap including self-paced; different sections are independent',()=>{
 const s=stage();s.rows.push({...s.rows[0]!,id:'B',mode:'SELF_PACED'});
 assert.throws(()=>validateFixedGeneralStage(s),/Overlapping/);
 s.rows[1]!.section=3;validateFixedGeneralStage(s);
 s.rows[1]!.id='A';assert.throws(()=>validateFixedGeneralStage(s),/Invalid fixed/);
 s.rows.pop();s.rows[0]!.endMinute=1080;assert.throws(()=>validateFixedGeneralStage(s),/Invalid fixed/);
});

test('scenario routes export fixed source times and reject both solver routes before any database write (synthetic route fixture)',async t=>{
 process.env.DATABASE_URL??='postgres://unused:unused@127.0.0.1:1/unused';
 const {default:Fastify}=await import('fastify');
 const {pool}=await import('../src/api/database.js');
 const {registerScenarios}=await import('../src/api/scenarios.js');
 const id='00000000-0000-4000-8000-000000000001';
 const input={scenarioName:'Stage 1',termId:'T',courses:[],instructors:[],rooms:[],policy:defaultPolicy(),fixedGeneralStage:stage()};
 const saved={id,department_id:id,state:'DRAFT',solver_status:'NOT_RUN',input_snapshot:input,result_snapshot:fixedGeneralStageResult(input)};
 const query=t.mock.method(pool,'query',async(sql:string)=>{
  assert.equal(sql,'SELECT * FROM scenarios WHERE id=$1','No mutation or solver run query may happen');
  return {rows:[saved],rowCount:1};
 });
 const app=Fastify();
 app.addHook('onRequest',async req=>{req.principal={id,role:'SYSTEM_ADMIN',collegeId:null,departmentId:null,username:'synthetic',csrf:'synthetic'};});
 await registerScenarios(app);
 try{
  for(const suffix of ['/solve','/solve/async','/review']){
   const response=await app.inject({method:'POST',url:'/api/v1/scenarios/'+id+suffix,payload:{}});
   assert.equal(response.statusCode,409);
   if(suffix.includes('solve'))assert.match(response.json().message,/المرحلة الثانية/);
  }
  const csv=await app.inject({url:'/api/v1/scenarios/'+id+'/external.csv'});
  assert.equal(csv.statusCode,200);assert.match(csv.body,/18:00/);assert.match(csv.body,/19:40/);assert.match(csv.body,/غير مذكور/);
  assert.equal(query.mock.callCount(),4);
 }finally{await app.close();}
});
