import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {defaultPolicy} from '../src/policy.js';
test('API retains null room facts and an approved local policy explicitly controls capacity checks',
 {skip:process.env.TPS_DB_INTEGRATION!=='1'},async()=>{
 const {pool}=await import('../src/api/database.js');const {createApp}=await import('../src/api/create-app.js');
 const argon2=(await import('argon2')).default;const app=await createApp(),key=randomUUID().slice(0,8),password=randomUUID();
 try{
  await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3)',['room_'+key,await argon2.hash(password),'SYSTEM_ADMIN']);
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'room_'+key,password}});
  const cookie=String(login.headers['set-cookie']).split(';')[0]!;
  const me=await app.inject({url:'/api/v1/auth/me',headers:{cookie}});const headers={cookie,'x-csrf-token':me.json().csrfToken};
  const post=async(path:string,payload:Record<string,unknown>,method:'POST'|'PUT'='POST')=>{
   const r=await app.inject({method,url:'/api/v1'+path,headers,payload});assert.equal(r.statusCode,200,r.body);return r.json();};
  const inst=await post('/institutions',{name:'Synthetic room policy '+key});
  const college=await post('/colleges',{institutionId:inst.id,name:'Synthetic college'});
  const department=await post('/departments',{collegeId:college.id,name:'Synthetic department'});
  const term=await post('/terms',{collegeId:college.id,code:key,label:'Synthetic',startsOn:'2027-01-01',endsOn:'2027-06-01'});
  await post('/courses',{departmentId:department.id,code:'C',title:'Synthetic theory',level:1,theoryHours:2,practicalHours:0,demand:20,blocks:['L1::A']});
  await post('/instructors',{departmentId:department.id,code:'I',name:'Synthetic',maxLoad:20});
  const room=await post('/rooms',{collegeId:college.id,code:'R',name:'Known type unknown capacity',type:'CLASSROOM',capacity:null});
  assert.equal(room.capacity,null);
  const unknown=await post('/rooms',{collegeId:college.id,code:'U',name:'Unclassified source facility',type:null,capacity:null});
  assert.equal(unknown.type,null);assert.equal(unknown.capacity,null);
  const context={departmentId:department.id,termId:term.id};
  const normal=await post('/scenarios',{...context,name:'Normal capacity checks'});assert.equal(normal.result.gaps.length,1);
  const policy=defaultPolicy();policy.ignoreRoomCapacity=true;
  await post('/policies',{...context,policy,rationale:'Explicit local capacity-independent planning test'},'PUT');
  await post('/policies/approve',context);
  const ignored=await post('/scenarios',{...context,name:'Explicit ignored room capacity'});assert.equal(ignored.result.gaps.length,0);
  const solved=await post('/scenarios/'+ignored.id+'/solve',{seconds:1,candidatesPerInstructor:2});assert.equal(solved.solverStatus,'COMPLETED');
  const ready=await app.inject({url:'/api/v1/scenarios/'+ignored.id+'/readiness',headers});
  assert.equal(ready.statusCode,200);assert.equal(ready.json().technicalReady,true);
  assert.ok(ready.json().issues.some((issue:{code:string})=>issue.code==='ROOM_CAPACITY_IGNORED'));
 }finally{await app.close();await pool.end();}
});
