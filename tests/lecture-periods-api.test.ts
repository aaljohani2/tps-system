import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {defaultPolicy} from '../src/policy.js';
import {withRequestedLecturePeriods} from '../src/lecture-periods.js';

test('approved local period policy persists, creates visible permitted overlaps and exports exact minutes',
 {skip:process.env.TPS_DB_INTEGRATION!=='1'},async()=>{
 const {createApp}=await import('../src/api/create-app.js');const {pool}=await import('../src/api/database.js');
 const argon2=(await import('argon2')).default,app=await createApp(),key=randomUUID().slice(0,8),password=randomUUID();
 try{
  await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3)',['period_'+key,await argon2.hash(password),'SYSTEM_ADMIN']);
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'period_'+key,password}});
  const cookie=String(login.headers['set-cookie']).split(';')[0]!;
  const me=await app.inject({url:'/api/v1/auth/me',headers:{cookie}}),headers={cookie,'x-csrf-token':me.json().csrfToken};
  const post=async(path:string,payload:Record<string,unknown>)=>{
   const response=await app.inject({method:'POST',url:'/api/v1'+path,headers,payload});assert.equal(response.statusCode,200,response.body);return response.json();
  };
  const institution=await post('/institutions',{name:'Synthetic period policy '+key});
  const college=await post('/colleges',{institutionId:institution.id,name:'Synthetic period college'});
  const department=await post('/departments',{collegeId:college.id,name:'Synthetic period department'});
  const term=await post('/terms',{collegeId:college.id,code:key,label:'Synthetic',startsOn:'2027-01-01',endsOn:'2027-06-01'});
  await post('/instructors',{departmentId:department.id,code:'2',name:'Synthetic Economics trainer',maxLoad:12,eligibleCourseCodes:['اقصد-101'],available:[{day:'SUN',from:10,to:12.5}]});
  const other=await post('/instructors',{departmentId:department.id,code:'OTHER',name:'Synthetic other',maxLoad:24,teachingRules:{preferredCreditedLoad:2,preferredSections:1,allowedCourseTypes:['THEORY','MIXED']},eligibleCourseCodes:['MAIN'],available:[{day:'SUN',from:10,to:12}]});
  const invalidTarget=await app.inject({method:'PATCH',url:'/api/v1/instructors/'+other.id,headers,payload:{maxLoad:1}});assert.equal(invalidTarget.statusCode,400);
  const changed=await app.inject({method:'PATCH',url:'/api/v1/instructors/'+other.id,headers,payload:{name:'Synthetic renamed target'}});assert.equal(changed.statusCode,200,changed.body);assert.equal(changed.json().teachingRules.preferredCreditedLoad,2);
  // PATCHing one rule must retain the existing theoretical/mixed-only guard and 2-hour load target.
  // A room or trainer can be available on Thursday afternoon in a fixed-period policy.
  const thursday=await app.inject({method:'PATCH',url:'/api/v1/instructors/'+other.id,headers,
   payload:{teachingRules:{maxSections:3},available:[{day:'THU',from:12,to:14.5}]}});
  assert.equal(thursday.statusCode,200,thursday.body);
  assert.equal(thursday.json().teachingRules.preferredCreditedLoad,2);
  assert.equal(thursday.json().teachingRules.preferredSections,1);
  assert.deepEqual(thursday.json().teachingRules.allowedCourseTypes,['THEORY','MIXED']);
  assert.equal(thursday.json().teachingRules.maxSections,3);
  assert.deepEqual(thursday.json().available,[{day:'THU',from:12,to:14.5}]);
  const incompatible=await app.inject({method:'PATCH',url:'/api/v1/instructors/'+other.id,headers,
   payload:{teachingRules:{maxSections:0}}});
  assert.equal(incompatible.statusCode,400,'Cannot lower max sections below the preserved preferred count');
  const restored=await app.inject({method:'PATCH',url:'/api/v1/instructors/'+other.id,headers,
   payload:{available:[{day:'SUN',from:10,to:12}]}});
  assert.equal(restored.statusCode,200,restored.body);
  await post('/courses',{departmentId:department.id,code:'اقصد-101',title:'مقدمة الاقتصاد',level:1,demand:20,theoryHours:3,practicalHours:0,blocks:['G::A'],assignedInstructorId:'2'});
  const unsafeLock=await app.inject({method:'POST',url:'/api/v1/courses',headers,payload:{
   departmentId:department.id,code:'PRACTICAL-ONLY',title:'Synthetic practical-only',level:1,demand:20,
   theoryHours:0,practicalHours:2,assignedInstructorId:'OTHER'}});
  assert.equal(unsafeLock.statusCode,409,'An instructor restricted to theory/mixed cannot be locked to a practical-only course');
  const mainCourse=await post('/courses',{departmentId:department.id,code:'MAIN',title:'Synthetic theory',level:1,demand:20,theoryHours:2,practicalHours:0,blocks:['G::A']});
  const unsafeConversion=await app.inject({method:'PATCH',url:'/api/v1/courses/'+mainCourse.id,headers,
   payload:{theoryHours:0,practicalHours:2,assignedInstructorId:'OTHER'}});
  assert.equal(unsafeConversion.statusCode,409,'A course edit must also respect the locked trainer course-type rules');
  for(const code of ['A','B'])await post('/rooms',{collegeId:college.id,code,name:'Synthetic classroom '+code,type:'CLASSROOM',capacity:30});
  const policy=withRequestedLecturePeriods(defaultPolicy(),'TRIM_END');policy.slots=[{day:'SUN',from:7,to:14.5}];
  policy.priorityCourseCodes=['MAIN'];
  const saved=await app.inject({method:'PUT',url:'/api/v1/policies',headers,payload:{departmentId:department.id,termId:term.id,policy,rationale:'Synthetic exact minute period regression'}});
  assert.equal(saved.statusCode,200,saved.body);await post('/policies/approve',{departmentId:department.id,termId:term.id});
  const loaded=await app.inject({url:'/api/v1/policies?departmentId='+department.id+'&termId='+term.id,headers});
  assert.deepEqual(loaded.json().effectivePolicy.lecturePeriods,policy.lecturePeriods);
  assert.deepEqual(loaded.json().effectivePolicy.priorityCourseCodes,['MAIN']);
  const scenario=await post('/scenarios',{departmentId:department.id,termId:term.id,name:'Synthetic fixed lecture periods'});
  assert.equal(scenario.result.gaps.length,0);
  const solved=await post('/scenarios/'+scenario.id+'/solve',{seconds:1,candidatesPerInstructor:3});assert.equal(solved.solverStatus,'COMPLETED');
  const readiness=await app.inject({url:'/api/v1/scenarios/'+scenario.id+'/readiness',headers});
  assert.equal(readiness.json().technicalReady,true);
  assert.ok(readiness.json().issues.some((issue:{code:string;severity:string})=>issue.code==='ECONOMICS_COHORT_OVERLAP'&&issue.severity==='WARNING'));
  const csv=await app.inject({url:'/api/v1/scenarios/'+scenario.id+'/export.csv',headers});assert.equal(csv.statusCode,200);assert.match(csv.body,/11:40/);assert.match(csv.body,/12:30/);
  const print=await app.inject({url:'/api/v1/scenarios/'+scenario.id+'/print',headers});assert.match(print.body,/11:40/);assert.match(print.body,/ECONOMICS_COHORT_OVERLAP/);
  for(const kind of ['instructors','trainees','rooms'])for(const format of ['xlsx','pdf']){
   const exported=await app.inject({url:'/api/v1/scenarios/'+scenario.id+'/reports/'+kind+'/'+format,headers});
   assert.equal(exported.statusCode,200,exported.headers['content-type']);
   assert.equal(exported.rawPayload.subarray(0,format==='pdf'?4:2).toString(),format==='pdf'?'%PDF':'PK');
   assert.equal(exported.headers['cache-control'],'private, no-store');
  }
  const unauthenticated=await app.inject({url:'/api/v1/scenarios/'+scenario.id+'/reports/instructors/pdf'});
  assert.equal(unauthenticated.statusCode,401);
  const otherDepartment=await post('/departments',{collegeId:college.id,name:'Synthetic unrelated report scope'});
  await pool.query('INSERT INTO users(username,password_hash,role,college_id,department_id) VALUES($1,$2,$3,$4,$5)',
   ['report_scope_'+key,await argon2.hash(password),'SCHEDULER',college.id,otherDepartment.id]);
  const otherLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'report_scope_'+key,password}});
  const otherCookie=String(otherLogin.headers['set-cookie']).split(';')[0]!;
  const denied=await app.inject({url:'/api/v1/scenarios/'+scenario.id+'/reports/instructors/pdf',headers:{cookie:otherCookie}});
  assert.equal(denied.statusCode,403);
 }finally{await app.close();await pool.end();}
});
