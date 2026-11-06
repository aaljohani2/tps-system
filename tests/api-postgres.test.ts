import test from 'node:test';
import assert from 'node:assert/strict';
const enabled=process.env.TPS_DB_INTEGRATION==='1';
test('authenticated end-to-end workflow persists a synthetic TPS scenario in PostgreSQL', {skip:!enabled},async()=>{
  const {createApp}=await import('../src/api/create-app.js');
  const {pool}=await import('../src/api/database.js');
  const argon2=(await import('argon2')).default;
  const {randomUUID}=await import('node:crypto');
  const app=await createApp();
  const uniq=randomUUID().slice(0,8);
  const username='test_'+uniq,password='temporary-synthetic-test-password';
  await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3)',
    [username,await argon2.hash(password,{type:argon2.argon2id}),'SYSTEM_ADMIN']);
  try{
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username,password}});
    assert.equal(login.statusCode,200,login.body);
    const cookie=login.headers['set-cookie'];
    assert.ok(cookie);
    const session=String(cookie).split(';')[0];
    const me=await app.inject({url:'/api/v1/auth/me',headers:{cookie:session}});
    assert.equal(me.statusCode,200,me.body);
    const csrf=me.json().csrfToken as string;
    const write=async(path:string,body:unknown)=>{
      const r=await app.inject({method:'POST',url:'/api/v1'+path,headers:{cookie:session,'x-csrf-token':csrf},payload:body});
      assert.equal(r.statusCode,200,r.body);return r.json();
    };
    const forbidden=await app.inject({method:'POST',url:'/api/v1/institutions',headers:{cookie:session},payload:{name:'Bad request'}});
    assert.equal(forbidden.statusCode,403,'CSRF required');
    const institution=await write('/institutions',{name:'مؤسسة اصطناعية '+uniq});
    const college=await write('/colleges',{institutionId:institution.id,name:'كلية اختبار '+uniq});
    const department=await write('/departments',{collegeId:college.id,name:'قسم اصطناعي'});
    const term=await write('/terms',{collegeId:college.id,code:'T-'+uniq,label:'فصل تجريبي',startsOn:'2027-01-17',endsOn:'2027-06-24'});
    const course=await write('/courses',{departmentId:department.id,code:'TEST-101',title:'اختبار التخطيط',
      level:1,theoryHours:2,practicalHours:0,demand:20,blocks:['BLK-1']});
    assert.equal(course.demand,20);
    await write('/instructors',{departmentId:department.id,code:'INS-1',name:'مدرب اصطناعي',maxLoad:18});
    await write('/rooms',{collegeId:college.id,code:'R-1',name:'قاعة اختبار',type:'CLASSROOM',capacity:30});
    const created=await write('/scenarios',{departmentId:department.id,termId:term.id,name:'مسودة اصطناعية'});
    assert.equal(created.result.metrics.sectionCount,1);
    const stored=await pool.query('SELECT id FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(stored.rowCount,1,'scenario must actually persist');
    const solve=await write('/scenarios/'+created.id+'/solve',{});
    assert.equal(solve.solverStatus,'COMPLETED','Timefold must run, not a disguised greedy fallback');
    assert.equal(solve.result.gaps.length,0,JSON.stringify(solve.result.gaps));
    await write('/scenarios/'+created.id+'/review',{});
    const approved=await write('/scenarios/'+created.id+'/approve',{});
    assert.equal(approved.state,'APPROVED');
    const persisted=await pool.query('SELECT state,approved_snapshot FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(persisted.rows[0]?.state,'APPROVED');
    assert.ok(persisted.rows[0]?.approved_snapshot?.result);
    const exportCsv=await app.inject({url:'/api/v1/scenarios/'+created.id+'/export.csv',headers:{cookie:session}});
    assert.equal(exportCsv.statusCode,200,exportCsv.body);
    assert.match(exportCsv.body,/TEST-101/);
    const next=await write('/scenarios/'+created.id+'/revise',{});
    assert.equal(next.revision,2);
    const compare=await app.inject({url:'/api/v1/scenarios/compare?ids='+created.id+','+next.id,headers:{cookie:session}});
    assert.equal(compare.statusCode,200,compare.body);
    assert.equal(compare.json().first.sections,1);
    assert.equal(compare.json().second.sections,1);
  }finally{await app.close();await pool.end();}
});
