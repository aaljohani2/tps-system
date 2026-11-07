import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

test('instructor timetable rules survive catalog patches and new term scenario creation',
 {skip:process.env.TPS_DB_INTEGRATION!=='1'},async()=>{
 const {createApp}=await import('../src/api/create-app.js');const {pool}=await import('../src/api/database.js');
 const argon2=(await import('argon2')).default,app=await createApp(),key=randomUUID().slice(0,8),password=randomUUID();
 try{
  await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3)',['rules_'+key,await argon2.hash(password),'SYSTEM_ADMIN']);
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'rules_'+key,password}});
  const cookie=String(login.headers['set-cookie']).split(';')[0]!;
  const me=await app.inject({url:'/api/v1/auth/me',headers:{cookie}}),headers={cookie,'x-csrf-token':me.json().csrfToken};
  const post=async(path:string,payload:Record<string,unknown>)=>{
   const response=await app.inject({method:'POST',url:'/api/v1'+path,headers,payload});assert.equal(response.statusCode,200,response.body);return response.json();
  };
  const institution=await post('/institutions',{name:'Synthetic instructor rules '+key});
  const college=await post('/colleges',{institutionId:institution.id,name:'Synthetic rules college'});
  const department=await post('/departments',{collegeId:college.id,name:'Synthetic rules department'});
  const term=await post('/terms',{collegeId:college.id,code:key,label:'Synthetic',startsOn:'2027-01-01',endsOn:'2027-06-01'});
  const teachingRules={maxContactHours:8,maxSections:2,preferredSections:2,allowedCourseTypes:['PRACTICAL'],preferredCourseTypes:['PRACTICAL']};
  const trainer=await post('/instructors',{departmentId:department.id,code:'1',name:'Synthetic trainer',maxLoad:8,teachingRules});
  assert.deepEqual(trainer.teachingRules,teachingRules);
  const edited=await app.inject({method:'PATCH',url:'/api/v1/instructors/'+trainer.id,headers,payload:{name:'Synthetic changed name'}});
  assert.equal(edited.statusCode,200,edited.body);assert.deepEqual(edited.json().teachingRules,teachingRules);
  await post('/rooms',{collegeId:college.id,code:'R',name:'Synthetic lab',type:'LAB',capacity:30});
  await post('/courses',{departmentId:department.id,code:'LAB',title:'Synthetic practical',level:1,demand:90,theoryHours:0,practicalHours:4,blocks:['A','B','C']});
  const scenario=await post('/scenarios',{departmentId:department.id,termId:term.id,name:'Two practical sections only'});
  assert.equal(scenario.result.sections.filter((section:{state:string})=>section.state==='SCHEDULED').length,2);
  assert.equal(scenario.result.instructorLoads[0].contact,8);assert.equal(scenario.result.gaps.length,1);
  const future=await post('/terms',{collegeId:college.id,code:'NEXT-'+key,label:'Synthetic future',startsOn:'2027-08-01',endsOn:'2027-12-01'});
  const next=await post('/scenarios',{departmentId:department.id,termId:future.id,name:'Persistent timetable rules'});
  assert.equal(next.result.instructorLoads[0].contact,8);assert.equal(next.result.gaps.length,1);
  const invalid=await app.inject({method:'PATCH',url:'/api/v1/instructors/'+trainer.id,headers,
   payload:{teachingRules:{maxSections:1,preferredSections:2}}});assert.equal(invalid.statusCode,400);
 }finally{await app.close();await pool.end();}
});
