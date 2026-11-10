import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {defaultPolicy} from '../src/policy.js';
import {withRequestedLecturePeriods} from '../src/lecture-periods.js';
import {mapGeneralCourses,type GeneralSourceItem} from '../src/general-courses.js';
import {buildDraftPlan} from '../src/planner.js';
import type {PlanRequest} from '../src/types.js';

test('stored provisional general constraints survive API solve/export and prevent approval of incomplete integration',
 {skip:process.env.TPS_DB_INTEGRATION!=='1'},async()=>{
 const {createApp}=await import('../src/api/create-app.js'),{pool}=await import('../src/api/database.js');
 const argon2=(await import('argon2')).default,app=await createApp(),key=randomUUID().slice(0,8),password=randomUUID();
 try{
  const actor=(await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3) RETURNING id',
   ['general_'+key,await argon2.hash(password),'SYSTEM_ADMIN'])).rows[0];
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'general_'+key,password}});
  const cookie=String(login.headers['set-cookie']).split(';')[0]!,me=await app.inject({url:'/api/v1/auth/me',headers:{cookie}});
  const headers={cookie,'x-csrf-token':me.json().csrfToken};
  const post=async(path:string,payload:Record<string,unknown>)=>{
   const response=await app.inject({method:'POST',url:'/api/v1'+path,headers,payload});assert.equal(response.statusCode,200,response.body);return response.json();
  };
  const institution=await post('/institutions',{name:'Synthetic general constraint '+key});
  const college=await post('/colleges',{institutionId:institution.id,name:'Synthetic general college'});
  const department=await post('/departments',{collegeId:college.id,name:'Synthetic general department'});
  const term=await post('/terms',{collegeId:college.id,code:key,label:'Synthetic',startsOn:'2027-01-01',endsOn:'2027-06-01'});
  const input:PlanRequest={scenarioName:'Synthetic partial general integration',termId:term.id,policy:withRequestedLecturePeriods(defaultPolicy(),'TRIM_END'),
   cohortBlocks:[{ref:'L1::A',level:1,size:20}],instructors:[{id:'T',name:'Synthetic internal trainer',maxLoad:24,allowedModes:['ONSITE'],eligibleCourseCodes:['MAIN']}],
   rooms:[{id:'R',name:'Synthetic classroom',type:'CLASSROOM',capacity:40}],courses:[
    {code:'MAIN',title:'Synthetic internal course',level:1,demand:20,theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['L1::A'],blockSizes:[20],blockGroups:[['L1::A']]},
    {code:'انجل-111',title:'لغة إنجليزية (1)',level:1,demand:20,theoryHours:4,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],assignmentScope:'EXTERNAL',externalSectionCapacity:40,sectionCapacity:40,blocks:['L1::A'],blockSizes:[20],blockGroups:[['L1::A']]}]};
  const item:GeneralSourceItem={id:'الإدارة!B4',sheet:'الإدارة',level:1,sourceGroup:'الإدارة:L1:G1',sourceGroupNumber:1,headerCell:'A2',sourceCells:['A2','B4','A4','A5'],
   rawTitle:'انجليزي 1',normalizedTitle:'انجليزي 1',kind:'DAY',day:'SUN',literalStartMinute:480,literalEndMinute:580,startMinute:480,endMinute:580,
   timingStatus:'EXPLICIT_INTERVAL',identifiersUnverified:[],relation:'SINGLE_SOURCE_OCCURRENCE'};
  input.generalCourseSchedule=mapGeneralCourses(input,[item],{file:'synthetic.xlsx',sha256:'a'.repeat(64),receivedAt:'2026-11-09'},'SYNTHETIC_BASE','Explicit synthetic planning instruction');
  const id=randomUUID();await pool.query(`INSERT INTO scenarios(id,department_id,term_id,name,input_snapshot,result_snapshot,created_by)
   VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,[id,department.id,term.id,input.scenarioName,JSON.stringify(input),JSON.stringify(buildDraftPlan(input)),actor.id]);
  const solved=await post('/scenarios/'+id+'/solve',{seconds:1,candidatesPerInstructor:8});assert.equal(solved.solverStatus,'COMPLETED');
  const saved=await app.inject({url:'/api/v1/scenarios/'+id,headers});assert.equal(saved.statusCode,200);
  const data=saved.json();assert.equal(data.input_snapshot.generalCourseSchedule.locks.length,1);assert.equal(data.result_snapshot.gaps.length,0);
  assert.ok(!data.result_snapshot.sessions.some((s:{day:string;start:number;end:number})=>s.day==='SUN'&&s.start<580/60&&s.end>8));
  const readiness=(await app.inject({url:'/api/v1/scenarios/'+id+'/readiness',headers})).json();assert.equal(readiness.technicalReady,false);
  assert.ok(readiness.issues.some((i:{code:string})=>i.code==='GENERAL_INTEGRATION_INCOMPLETE'));
  for(const format of ['xlsx','pdf']){
   const exported=await app.inject({url:'/api/v1/scenarios/'+id+'/reports/trainees/'+format,headers});assert.equal(exported.statusCode,200,exported.body.slice(0,100));
   assert.equal(exported.rawPayload.subarray(0,format==='pdf'?4:2).toString(),format==='pdf'?'%PDF':'PK');
  }
  await post('/scenarios/'+id+'/review',{});
  const approval=await app.inject({method:'POST',url:'/api/v1/scenarios/'+id+'/approve',headers,payload:{}});assert.equal(approval.statusCode,409);
  assert.match(approval.body,/GENERAL_INTEGRATION_INCOMPLETE/);
  assert.equal((await pool.query('SELECT approved_snapshot FROM scenarios WHERE id=$1',[id])).rows[0].approved_snapshot,null);
 }finally{await app.close();await pool.end();}
});
