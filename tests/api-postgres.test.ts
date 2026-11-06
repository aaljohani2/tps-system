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
      const r=await app.inject({method:'POST',url:'/api/v1'+path,headers:{cookie:session,'x-csrf-token':csrf},payload:body as Record<string,unknown>});
      assert.equal(r.statusCode,200,r.body);return r.json();
    };
    const forbidden=await app.inject({method:'POST',url:'/api/v1/institutions',headers:{cookie:session},payload:{name:'Bad request'}});
    assert.equal(forbidden.statusCode,403,'CSRF required');
    const institution=await write('/institutions',{name:'مؤسسة اصطناعية '+uniq});
    const college=await write('/colleges',{institutionId:institution.id,name:'كلية اختبار '+uniq});
    const department=await write('/departments',{collegeId:college.id,name:'قسم اصطناعي'});
    const term=await write('/terms',{collegeId:college.id,code:'T-'+uniq,label:'فصل تجريبي',startsOn:'2027-01-17',endsOn:'2027-06-24'});
    const sibling=await write('/departments',{collegeId:college.id,name:'Sibling department '+uniq});
    const scopedLogin='head_'+uniq;
    await pool.query('INSERT INTO users(username,password_hash,role,college_id,department_id) VALUES($1,$2,$3,$4,$5)',
      [scopedLogin,await argon2.hash(password,{type:argon2.argon2id}),'DEPARTMENT_HEAD',college.id,department.id]);
    const scopedSession=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:scopedLogin,password}});
    assert.equal(scopedSession.statusCode,200,scopedSession.body);
    const limitedCookie=String(scopedSession.headers['set-cookie']).split(';')[0];
    const limitedMe=await app.inject({url:'/api/v1/auth/me',headers:{cookie:limitedCookie}});
    const limitedCsrf=limitedMe.json().csrfToken as string;
    const noCrossDept=await app.inject({url:'/api/v1/courses?departmentId='+sibling.id,
      headers:{cookie:limitedCookie}});
    assert.equal(noCrossDept.statusCode,403,'Department head must not read another department');
    const noNewShared=await app.inject({method:'POST',url:'/api/v1/departments',
      headers:{cookie:limitedCookie,'x-csrf-token':limitedCsrf},
      payload:{collegeId:college.id,name:'Unauthorized shared master'}});
    assert.equal(noNewShared.statusCode,403,'Department role must not mutate shared college structures');
    const noPolicyApprove=await app.inject({method:'POST',url:'/api/v1/policies/approve',
      headers:{cookie:limitedCookie,'x-csrf-token':limitedCsrf},
      payload:{departmentId:department.id,termId:term.id}});
    assert.equal(noPolicyApprove.statusCode,403,'Department head cannot approve policies');

    const policyUrl='/api/v1/policies?departmentId='+department.id+'&termId='+term.id;
    const policyInitial=await app.inject({url:policyUrl,headers:{cookie:session}});
    assert.equal(policyInitial.statusCode,200,policyInitial.body);
    assert.deepEqual(policyInitial.json().effectivePolicy.enabledModes,['ONSITE']);
    const policy=policyInitial.json().effectivePolicy;
    const policyWrite=await app.inject({method:'PUT',url:'/api/v1/policies',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{departmentId:department.id,termId:term.id,
        policy:{...policy,enabledModes:['ONSITE','REMOTE']},rationale:'Synthetic policy revision for automated testing'}});
    assert.equal(policyWrite.statusCode,200,policyWrite.body);
    assert.equal(policyWrite.json().draftRevision,1);
    const pending=await app.inject({url:policyUrl,headers:{cookie:session}});
    assert.equal(pending.json().pending,true);
    assert.deepEqual(pending.json().effectivePolicy.enabledModes,['ONSITE'],'draft must not enable remote');
    const approvedPolicy=await write('/policies/approve',{departmentId:department.id,termId:term.id});
    assert.equal(approvedPolicy.approvedRevision,1);
    const savedPolicy=await app.inject({url:policyUrl,headers:{cookie:session}});
    assert.deepEqual(savedPolicy.json().effectivePolicy.enabledModes,['ONSITE','REMOTE']);
    const cannotRepeat=await app.inject({method:'POST',url:'/api/v1/policies/approve',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{departmentId:department.id,termId:term.id}});
    assert.equal(cannotRepeat.statusCode,409);
    const course=await write('/courses',{departmentId:department.id,code:'TEST-101',title:'اختبار التخطيط',
      level:1,theoryHours:2,practicalHours:0,demand:20,blocks:['BLK-1']});
    assert.equal(course.demand,20);
    const {readFile}=await import('node:fs/promises');
    const template=await readFile('web/templates/TPS_Course_Demand_144720.xlsx');
    const imported=await app.inject({method:'POST',
      url:'/api/v1/import/courses/preview-xlsx?departmentId='+department.id,
      headers:{cookie:session,'x-csrf-token':csrf,
        'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
      payload:template});
    assert.equal(imported.statusCode,200,imported.body);
    assert.equal(imported.json().schemaVersion,'tps.catalog.v1');
    const trainer=await write('/instructors',{departmentId:department.id,code:'INS-1',name:'مدرب اصطناعي',maxLoad:18});
    const room=await write('/rooms',{collegeId:college.id,code:'R-1',name:'قاعة اختبار',type:'CLASSROOM',capacity:30});
    const patch=async(url:string,payload:unknown)=>{
      const response=await app.inject({method:'PATCH',url:'/api/v1'+url,
        headers:{cookie:session,'x-csrf-token':csrf},payload:payload as Record<string,unknown>});
      assert.equal(response.statusCode,200,response.body);
      return response.json();
    };
    const updatedTrainer=await patch('/instructors/'+trainer.id,{maxLoad:20,
      available:[{day:'SUN',from:8,to:16}],allowedModes:['ONSITE','REMOTE'],
      overload:{additionalHours:2,reason:'Synthetic approved extra load'}});
    assert.equal(Number(updatedTrainer.maxLoad),20);
    const updatedRoom=await patch('/rooms/'+room.id,{capacity:50,building:'T1'});
    assert.equal(updatedRoom.capacity,50);
    const invalidWindow=await app.inject({method:'PATCH',url:'/api/v1/rooms/'+room.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{available:[{day:'THU',from:8,to:12}]}});
    assert.equal(invalidWindow.statusCode,400,'Thursday room availability must respect schedule limits');

    const injectedPolicy=await app.inject({method:'POST',url:'/api/v1/scenarios',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{departmentId:department.id,termId:term.id,name:'Override attempt',policy:{enabledModes:['HYBRID']}}});
    assert.equal(injectedPolicy.statusCode,400,'Policy override must be rejected');
    const created=await write('/scenarios',{departmentId:department.id,termId:term.id,name:'مسودة اصطناعية'});
    assert.equal(created.result.metrics.sectionCount,1);
    const policySnapshot=await pool.query('SELECT policy_revision,input_snapshot FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(policySnapshot.rows[0]?.policy_revision,1);
    assert.deepEqual(policySnapshot.rows[0]?.input_snapshot.policy.enabledModes,['ONSITE','REMOTE']);
    const stored=await pool.query('SELECT id FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(stored.rowCount,1,'scenario must actually persist');
    const solve=await write('/scenarios/'+created.id+'/solve',{});
    assert.equal(solve.solverStatus,'COMPLETED','Timefold must run, not a disguised greedy fallback');
    const solveAgain=await app.inject({method:'POST',url:'/api/v1/scenarios/'+created.id+'/solve',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{}});
    assert.equal(solveAgain.statusCode,409,'a solved scenario must not be solved twice');
    assert.equal(solve.result.gaps.length,0,JSON.stringify(solve.result.gaps));
    const readiness=await app.inject({url:'/api/v1/scenarios/'+created.id+'/readiness',headers:{cookie:session}});
    assert.equal(readiness.statusCode,200,readiness.body);
    assert.equal(readiness.json().technicalReady,true,JSON.stringify(readiness.json().issues));
    await write('/scenarios/'+created.id+'/review',{});
    const approved=await write('/scenarios/'+created.id+'/approve',{});
    assert.equal(approved.state,'APPROVED');
    const persisted=await pool.query('SELECT state,approved_snapshot FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(persisted.rows[0]?.state,'APPROVED');
    assert.ok(persisted.rows[0]?.approved_snapshot?.result);
    const exportCsv=await app.inject({url:'/api/v1/scenarios/'+created.id+'/export.csv',headers:{cookie:session}});
    assert.equal(exportCsv.statusCode,200,exportCsv.body);
    assert.match(exportCsv.body,/TEST-101/);
    const exportXlsx=await app.inject({url:'/api/v1/scenarios/'+created.id+'/export.xlsx',headers:{cookie:session}});
    assert.equal(exportXlsx.statusCode,200,exportXlsx.body);
    assert.equal(exportXlsx.rawPayload.subarray(0,2).toString('ascii'),'PK');
    const fork=await write('/scenarios/'+created.id+'/fork',{
      name:'Demand expansion (synthetic)',
      overrides:[{code:'TEST-101',demand:50,blocks:['BLK-1','BLK-2']}]});
    assert.equal(fork.result.metrics.sectionCount,2);
    const persistedOriginal=await pool.query('SELECT input_snapshot FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(persistedOriginal.rows[0]?.input_snapshot.courses[0].demand,20,'fork must preserve original demand');
    const forkComparison=await app.inject({url:'/api/v1/scenarios/compare?ids='+created.id+','+fork.id,
      headers:{cookie:session}});
    assert.equal(forkComparison.statusCode,200,forkComparison.body);
    assert.equal(forkComparison.json().first.sections,1);
    assert.equal(forkComparison.json().second.sections,2);
    const forkRecord=await pool.query('SELECT parent_scenario_id,solver_status FROM scenarios WHERE id=$1',[fork.id]);
    assert.equal(forkRecord.rows[0]?.parent_scenario_id,created.id);
    assert.equal(forkRecord.rows[0]?.solver_status,'NOT_RUN');
    const next=await write('/scenarios/'+created.id+'/revise',{});
    assert.equal(next.revision,2);
    const compare=await app.inject({url:'/api/v1/scenarios/compare?ids='+created.id+','+next.id,headers:{cookie:session}});
    assert.equal(compare.statusCode,200,compare.body);
    assert.equal(compare.json().first.sections,1);
    assert.equal(compare.json().second.sections,1);
  }finally{await app.close();await pool.end();}
});
