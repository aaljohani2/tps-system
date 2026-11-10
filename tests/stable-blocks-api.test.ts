import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStableBlockPlan,type FixedGeneralSource} from '../src/stable-blocks.js';
import {defaultPolicy} from '../src/policy.js';
import {withRequestedLecturePeriods} from '../src/lecture-periods.js';
import {buildDraftPlan} from '../src/planner.js';
import {buildScenarioReport} from '../src/scenario-reports.js';
import type {PlanRequest} from '../src/types.js';

test('stable source survives PostgreSQL JSONB, authenticated Timefold solve and reports; incomplete coverage blocks approval',
 {skip:process.env.TPS_DB_INTEGRATION!=='1'},async()=>{
 const {createApp}=await import('../src/api/create-app.js'),{pool}=await import('../src/api/database.js');
 const argon2=(await import('argon2')).default,app=await createApp(),key=randomUUID().slice(0,8),password=randomUUID();
 try{
  const actor=(await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3) RETURNING id',
   ['stable_'+key,await argon2.hash(password),'SYSTEM_ADMIN'])).rows[0];
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'stable_'+key,password}});
  const cookie=String(login.headers['set-cookie']).split(';')[0]!,me=await app.inject({url:'/api/v1/auth/me',headers:{cookie}});
  const headers={cookie,'x-csrf-token':me.json().csrfToken};
  const post=async(path:string,payload:Record<string,unknown>)=>{
   const response=await app.inject({method:'POST',url:'/api/v1'+path,headers,payload});assert.equal(response.statusCode,200,response.body);return response.json();
  };
  const institution=await post('/institutions',{name:'Synthetic stable '+key});
  const college=await post('/colleges',{institutionId:institution.id,name:'Synthetic stable college'});
  const department=await post('/departments',{collegeId:college.id,name:'Synthetic stable department'});
  const term=await post('/terms',{collegeId:college.id,code:key,label:'Synthetic',startsOn:'2027-01-01',endsOn:'2027-06-01'});
  const base:PlanRequest={scenarioName:'Synthetic stable',termId:term.id,policy:withRequestedLecturePeriods(defaultPolicy(),'TRIM_END'),
   projection:{key:'BASE',label:'Synthetic',sourceTermId:term.id,newIntake:40,levelStudents:{1:40,2:0,3:0,4:0,5:0},cooperativeStudents:0,cooperativeAdministrativeBlocks:0,baseBlocksByLevel:{},assumptions:[],rules:{theory:40,mixed:40,practical:40,economics:50}},
   instructors:[{id:'4',name:'Synthetic trainer',maxLoad:22,allowedModes:['ONSITE']}],rooms:[{id:'R',name:'Synthetic room',type:'CLASSROOM',capacity:40}],
   courses:[{code:'ادار-101',title:'Synthetic principles',level:1,demand:40,theoryHours:4,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],sectionCapacity:40,blockSizes:[40]},
    {code:'انجل-111',title:'Synthetic English',level:1,demand:40,theoryHours:4,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],assignmentScope:'EXTERNAL',sectionCapacity:40}]};
  const row:FixedGeneralSource={id:'الإدارة!B4',sheet:'الإدارة',level:1,sourceGroup:'G1',sourceGroupNumber:1,headerCell:'A2',sourceCells:['B4'],rawTitle:'English',normalizedTitle:'English',kind:'DAY',day:'THU',literalStartMinute:480,literalEndMinute:580,startMinute:480,endMinute:580,timingStatus:'EXPLICIT_INTERVAL',identifiersUnverified:[],relation:'UNRESOLVED',courseCode:'انجل-111',physicalColored:false,plannedMode:'REMOTE',deliveryMarker:'CANDIDATE_TIMED'};
  const input=createStableBlockPlan(base,'SYNTHETIC_BASE',[row],'a'.repeat(64)),id=randomUUID();
  await pool.query(`INSERT INTO scenarios(id,department_id,term_id,name,input_snapshot,result_snapshot,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
   [id,department.id,term.id,input.scenarioName,JSON.stringify(input),JSON.stringify(buildDraftPlan(input)),actor.id]);
  const solved=await post('/scenarios/'+id+'/solve',{seconds:1,candidatesPerInstructor:8});assert.equal(solved.solverStatus,'COMPLETED');
  const saved=(await app.inject({url:'/api/v1/scenarios/'+id,headers})).json();
  assert.equal(saved.input_snapshot.stableBlockPlan.remoteSectionCapacity,100);assert.equal(saved.result_snapshot.gaps.length,0);
  assert.ok(saved.result_snapshot.sessions.every((s:{day:string;instructorId:string})=>s.day!=='THU'&&s.instructorId==='4'));
  const ready=(await app.inject({url:'/api/v1/scenarios/'+id+'/readiness',headers})).json();assert.equal(ready.technicalReady,false);
  const report=await app.inject({url:'/api/v1/scenarios/'+id+'/reports/trainees/xlsx',headers});
  assert.equal(report.statusCode,200);assert.equal(report.rawPayload.subarray(0,2).toString(),'PK');
  const dto=buildScenarioReport(saved.input_snapshot,saved.result_snapshot,{scenarioId:id,scenarioName:input.scenarioName,state:'DRAFT',solverStatus:'COMPLETED',revision:1,policyRevision:1,collegeName:'Synthetic',departmentName:'Synthetic',termLabel:'Synthetic',termCode:key,generatedAt:'2026-11-09'},'trainees',ready.issues);
  assert.equal(dto.entities[0]!.meetings.find(m=>m.sourceRef)?.mode,'REMOTE');
  assert.match(dto.entities[0]!.notes[0]!,/أيام القدوم للكلية:/);
  const csv=await app.inject({url:'/api/v1/scenarios/'+id+'/external.csv',headers});assert.match(csv.body,/ليس شعبة مصدر/);
 }finally{await app.close();await pool.end();}
});
