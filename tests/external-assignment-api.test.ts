import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

test('external course ownership persists in master data and scenarios expose a separate exportable roster',
 {skip:process.env.TPS_DB_INTEGRATION!=='1'},async()=>{
 const {createApp}=await import('../src/api/create-app.js');const {pool}=await import('../src/api/database.js');
 const argon2=(await import('argon2')).default;const app=await createApp(),key=randomUUID().slice(0,8),password=randomUUID();
 try{
  await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3)',['ext_'+key,await argon2.hash(password),'SYSTEM_ADMIN']);
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'ext_'+key,password}});
  const cookie=String(login.headers['set-cookie']).split(';')[0]!;
  const me=await app.inject({url:'/api/v1/auth/me',headers:{cookie}});const headers={cookie,'x-csrf-token':me.json().csrfToken};
  const post=async(path:string,payload:Record<string,unknown>)=>{
   const r=await app.inject({method:'POST',url:'/api/v1'+path,headers,payload});assert.equal(r.statusCode,200,r.body);return r.json();};
  const institution=await post('/institutions',{name:'Synthetic external '+key});
  const college=await post('/colleges',{institutionId:institution.id,name:'Synthetic college'});
  const department=await post('/departments',{collegeId:college.id,name:'Synthetic department'});
  const term=await post('/terms',{collegeId:college.id,code:key,label:'Synthetic',startsOn:'2027-01-01',endsOn:'2027-06-01'});
  const own=await post('/courses',{departmentId:department.id,code:'OWN',title:'Department course',level:2,demand:20,theoryHours:2,practicalHours:0,blocks:['L2::A']});
  const general=await post('/courses',{departmentId:department.id,code:'GENERAL',title:'General computing',level:1,demand:157,
   theoryHours:0,practicalHours:4,assignmentScope:'EXTERNAL',externalSectionCapacity:40});
  assert.equal(general.assignmentScope,'EXTERNAL');assert.equal(general.externalSectionCapacity,40);
  await post('/instructors',{departmentId:department.id,code:'LOCAL',name:'Synthetic local',maxLoad:18,eligibleCourseCodes:['OWN']});
  await post('/rooms',{collegeId:college.id,code:'R',name:'Synthetic',type:'CLASSROOM',capacity:30});
  const scenario=await post('/scenarios',{departmentId:department.id,termId:term.id,name:'Department only with external demand'});
  assert.equal(scenario.result.metrics.sectionCount,1);assert.equal(scenario.result.gaps.length,0);
  assert.equal(scenario.result.externalSections.length,4);
  assert.deepEqual(scenario.result.externalSections.map((section:{students:number})=>section.students),[40,40,40,37]);
  assert.equal(scenario.result.instructorLoads[0].credited,2);
  const exported=await app.inject({url:'/api/v1/scenarios/'+scenario.id+'/external.csv',headers});
  assert.equal(exported.statusCode,200);assert.match(exported.body,/General computing/);assert.match(exported.body,/بانتظار إسناد القسم الآخر/);
  assert.ok(!exported.body.includes('Synthetic local'),'No department trainer is invented for external courses');
  const solved=await post('/scenarios/'+scenario.id+'/solve',{seconds:1,candidatesPerInstructor:1});
  assert.equal(solved.solverStatus,'COMPLETED');assert.equal(solved.result.externalSections.length,4);
  const future=await post('/terms',{collegeId:college.id,code:'NEXT-'+key,label:'Future synthetic',startsOn:'2027-08-01',endsOn:'2027-12-01'});
  const next=await post('/scenarios',{departmentId:department.id,termId:future.id,name:'Master ownership persists across terms'});
  assert.equal(next.result.externalSections.length,4);assert.equal(next.result.metrics.sectionCount,1);
  const patch=await app.inject({method:'PATCH',url:'/api/v1/courses/'+general.id,headers,payload:{title:'Updated general title'}});
  assert.equal(patch.statusCode,200,patch.body);assert.equal(patch.json().assignmentScope,'EXTERNAL');
  // Existing verified blocks must be packed against the external limit before policy exceptions are normalized.
  const {defaultPolicy}=await import('../src/policy.js');
  const {fromDatabase}=await import('../src/api/scenarios.js');
  const {buildDraftPlan}=await import('../src/planner.js');
  await pool.query('UPDATE courses SET theory_hours=3,practical_hours=0 WHERE id=$1',[general.id]);
  const ownCohort=(await pool.query(`INSERT INTO cohorts(department_id,code,name,level) VALUES($1,'OWN-COHORT','Synthetic own cohort',2) RETURNING id`,[department.id])).rows[0];
  const ownBlock=(await pool.query("INSERT INTO student_blocks(cohort_id,code,name,size) VALUES($1,'A','Synthetic own block',20) RETURNING id",[ownCohort.id])).rows[0];
  await pool.query('INSERT INTO block_course_assignments(block_id,course_id,term_id) VALUES($1,$2,$3)',[ownBlock.id,own.id,term.id]);
  const cohort=(await pool.query(`INSERT INTO cohorts(department_id,code,name,level) VALUES($1,'GENERAL-COHORT','Synthetic cohort',1) RETURNING id`,[department.id])).rows[0];
  for(const [index,size] of [30,30,30,30,30,7].entries()){
   const block=(await pool.query('INSERT INTO student_blocks(cohort_id,code,name,size) VALUES($1,$2,$2,$3) RETURNING id',
    [cohort.id,'B'+index,size])).rows[0];
   await pool.query('INSERT INTO block_course_assignments(block_id,course_id,term_id) VALUES($1,$2,$3)',[block.id,general.id,term.id]);
  }
  const policy=defaultPolicy();policy.capacities.ONSITE.theory=100;
  const inherited=await fromDatabase(department.id,term.id,'Packed external inheritance',policy);
  assert.deepEqual(buildDraftPlan(inherited).externalSections!.map(section=>section.students),[40,40,40,37]);
  assert.equal(policy.courseSectionCapacities,undefined,'Loading a scenario must not mutate its caller policy');
 }finally{await app.close();await pool.end();}
});
