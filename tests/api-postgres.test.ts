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
    const collegeAdminPassword='synthetic-strong-account-secret';
    const collegeAdmin=await write('/users',{username:'college_admin_'+uniq,password:collegeAdminPassword,
      role:'COLLEGE_ADMIN',collegeId:college.id,departmentId:null});
    assert.ok(collegeAdmin.id);
    const adminLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',
      payload:{username:'college_admin_'+uniq,password:collegeAdminPassword}});
    assert.equal(adminLogin.statusCode,200,adminLogin.body);
    const adminCookie=String(adminLogin.headers['set-cookie']).split(';')[0];
    const adminMe=await app.inject({url:'/api/v1/auth/me',headers:{cookie:adminCookie}});
    const adminCsrf=adminMe.json().csrfToken as string;
    const cannotGrantSystem=await app.inject({method:'POST',url:'/api/v1/users',
      headers:{cookie:adminCookie,'x-csrf-token':adminCsrf},
      payload:{username:'system_escalation_'+uniq,password:collegeAdminPassword,
        role:'SYSTEM_ADMIN',collegeId:null,departmentId:null}});
    assert.equal(cannotGrantSystem.statusCode,403,'College admin cannot escalate system roles');
    const limited=await app.inject({method:'POST',url:'/api/v1/users',
      headers:{cookie:adminCookie,'x-csrf-token':adminCsrf},
      payload:{username:'viewer_'+uniq,password:collegeAdminPassword,
        role:'VIEWER',collegeId:college.id,departmentId:department.id}});
    assert.equal(limited.statusCode,200,limited.body);
    assert.equal(limited.json().role,'VIEWER');
    assert.equal(limited.json().password_hash,undefined,'password hash must not be exposed');
    const disabled=await app.inject({method:'PATCH',url:'/api/v1/users/'+limited.json().id,
      headers:{cookie:adminCookie,'x-csrf-token':adminCsrf},payload:{active:false}});
    assert.equal(disabled.statusCode,200,disabled.body);
    const deniedLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',
      payload:{username:'viewer_'+uniq,password:collegeAdminPassword}});
    assert.equal(deniedLogin.statusCode,401,'Disabled user cannot login');

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
    const notApprovedMode=await app.inject({method:'PATCH',url:'/api/v1/courses/'+course.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{mode:'REMOTE'}});
    assert.equal(notApprovedMode.statusCode,409,'mode cannot be used without independent course eligibility');
    const cannotSelfApprove=await app.inject({method:'PATCH',url:'/api/v1/courses/'+course.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{mode:'REMOTE',eligibleModes:['REMOTE']}});
    assert.equal(cannotSelfApprove.statusCode,400,'normal edit cannot grant its own eligibility');
    const eligibility=await app.inject({method:'PUT',url:'/api/v1/courses/'+course.id+'/eligibility',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{eligibleModes:['ONSITE','REMOTE'],reason:'Approved in synthetic test for planning'}});
    assert.equal(eligibility.statusCode,200,eligibility.body);
    assert.deepEqual(eligibility.json().eligible_modes,['ONSITE','REMOTE']);

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
      available:[{day:'SUN',from:8,to:16}],allowedModes:['ONSITE','REMOTE']});
    assert.equal(Number(updatedTrainer.maxLoad),20);
    const updatedRoom=await patch('/rooms/'+room.id,{capacity:50,building:'T1'});
    assert.equal(updatedRoom.capacity,50);
    const manual=await patch('/courses/'+course.id,{assignedInstructorId:'INS-1',exclusiveInstructor:true});
    assert.equal(manual.assignedInstructorId,'INS-1');
    assert.equal(manual.exclusiveInstructor,true);
    const unknownLock=await app.inject({method:'PATCH',url:'/api/v1/courses/'+course.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{assignedInstructorId:'NONEXISTENT'}});
    assert.equal(unknownLock.statusCode,409,'manual trainer must belong to department');
    const wrongSplit=await app.inject({method:'PATCH',url:'/api/v1/courses/'+course.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{
        hybridSplit:{theoryOnsiteHours:1,theoryRemoteHours:1,practicalOnsiteHours:0,practicalRemoteHours:0}
      }});
    assert.equal(wrongSplit.statusCode,409,'onsite course cannot have hybrid hours');

    const invalidWindow=await app.inject({method:'PATCH',url:'/api/v1/rooms/'+room.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{available:[{day:'THU',from:8,to:12}]}});
    assert.equal(invalidWindow.statusCode,400,'Thursday room availability must respect schedule limits');

    const injectedPolicy=await app.inject({method:'POST',url:'/api/v1/scenarios',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{departmentId:department.id,termId:term.id,name:'Override attempt',policy:{enabledModes:['HYBRID']}}});
    assert.equal(injectedPolicy.statusCode,400,'Policy override must be rejected');
    const created=await write('/scenarios',{departmentId:department.id,termId:term.id,name:'مسودة اصطناعية'});
    assert.equal(created.result.metrics.sectionCount,1);
    const forbiddenDirectOverload=await app.inject({method:'PATCH',url:'/api/v1/instructors/'+trainer.id,
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{overload:{additionalHours:2,reason:'Unapproved attempt'}}});
    assert.equal(forbiddenDirectOverload.statusCode,400,
      'No editor may grant extra load directly on the master instructor record');
    const exception=await write('/load-exceptions',{instructorId:trainer.id,termId:term.id,
      additionalHours:2,reason:'Synthetic documented temporary teaching load'});
    assert.equal(exception.state,'PENDING');
    const beforeDecision=await pool.query('SELECT input_snapshot FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(beforeDecision.rows[0].input_snapshot.instructors[0].overload,undefined,
      'Unapproved load must not enter existing scenario snapshot');
    const noHeadApproval=await app.inject({method:'POST',
      url:'/api/v1/load-exceptions/'+exception.id+'/decision',
      headers:{cookie:limitedCookie,'x-csrf-token':limitedCsrf},
      payload:{decision:'APPROVED',reason:'Unauthorized department approval'}});
    assert.equal(noHeadApproval.statusCode,403,'Department editor cannot approve own load exception');
    const approval=await write('/load-exceptions/'+exception.id+'/decision',
      {decision:'APPROVED',reason:'Approved for synthetic test semester'});
    assert.equal(approval.state,'APPROVED');
    const future=await write('/scenarios',{departmentId:department.id,termId:term.id,name:'Synthetic approved load'});
    const approvedLoad=future.result.instructorLoads.find((i:{id:string})=>i.id==='INS-1');
    assert.equal(approvedLoad.approvedException,2);
    const futureRow=await pool.query('SELECT input_snapshot FROM scenarios WHERE id=$1',[future.id]);
    assert.equal(futureRow.rows[0].input_snapshot.instructors[0].overload.additionalHours,2);
    const priorUnchanged=await pool.query('SELECT input_snapshot FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(priorUnchanged.rows[0].input_snapshot.instructors[0].overload,undefined);
    const repeatApproval=await app.inject({method:'POST',
      url:'/api/v1/load-exceptions/'+exception.id+'/decision',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{decision:'APPROVED',reason:'Duplicate decision blocked'}});
    assert.equal(repeatApproval.statusCode,409);
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
    // Manual rescheduling must be transactional, versioned and fail closed.
    const existingSession=solve.result.sessions[0];
    const originalStart=existingSession.start;
    const editBody={editVersion:0,day:'SUN',start:9.5,roomId:'R-1',
      instructorId:'INS-1',reason:'Synthetic timetable adjustment with audit'};
    const withoutCsrf=await app.inject({method:'PATCH',
      url:'/api/v1/scenarios/'+created.id+'/sessions/'+encodeURIComponent(existingSession.id),
      headers:{cookie:session},payload:editBody});
    assert.equal(withoutCsrf.statusCode,403,'Manual edit must require CSRF');
    const invalidManual=await app.inject({method:'PATCH',
      url:'/api/v1/scenarios/'+created.id+'/sessions/'+encodeURIComponent(existingSession.id),
      headers:{cookie:session,'x-csrf-token':csrf},payload:{...editBody,start:10.25}});
    assert.equal(invalidManual.statusCode,400,'Quarter-hour schedules are not allowed');
    const absentTrainer=await app.inject({method:'PATCH',
      url:'/api/v1/scenarios/'+created.id+'/sessions/'+encodeURIComponent(existingSession.id),
      headers:{cookie:session,'x-csrf-token':csrf},payload:{...editBody,instructorId:'UNKNOWN'}});
    assert.equal(absentTrainer.statusCode,409,'Unknown trainer must be rejected without writing');
    const wrongAvailability=await app.inject({method:'PATCH',
      url:'/api/v1/scenarios/'+created.id+'/sessions/'+encodeURIComponent(existingSession.id),
      headers:{cookie:session,'x-csrf-token':csrf},payload:{...editBody,day:'MON'}});
    assert.equal(wrongAvailability.statusCode,409,'Trainer availability must block manual move');
    const validManual=await app.inject({method:'PATCH',
      url:'/api/v1/scenarios/'+created.id+'/sessions/'+encodeURIComponent(existingSession.id),
      headers:{cookie:session,'x-csrf-token':csrf},payload:editBody});
    assert.equal(validManual.statusCode,200,validManual.body);
    assert.equal(validManual.json().editVersion,1);
    assert.equal(validManual.json().session.start,9.5);
    const stale=await app.inject({method:'PATCH',
      url:'/api/v1/scenarios/'+created.id+'/sessions/'+encodeURIComponent(existingSession.id),
      headers:{cookie:session,'x-csrf-token':csrf},payload:editBody});
    assert.equal(stale.statusCode,409,'Stale edits cannot overwrite a concurrent change');
    const editLog=await app.inject({url:'/api/v1/scenarios/'+created.id+'/edits',headers:{cookie:session}});
    assert.equal(editLog.statusCode,200,editLog.body);
    assert.equal(editLog.json()[0].edit_version,1);
    assert.equal(editLog.json()[0].before_snapshot.start,originalStart);
    const savedEdit=await pool.query('SELECT edit_version,result_snapshot FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(savedEdit.rows[0].edit_version,1);
    assert.equal(savedEdit.rows[0].result_snapshot.sessions[0].start,9.5);
    await write('/scenarios/'+created.id+'/review',{});
    const approved=await write('/scenarios/'+created.id+'/approve',{});
    assert.equal(approved.state,'APPROVED');
    const persisted=await pool.query('SELECT state,approved_snapshot FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(persisted.rows[0]?.state,'APPROVED');
    assert.ok(persisted.rows[0]?.approved_snapshot?.result);
    const approvedImmutable=await app.inject({method:'PATCH',
      url:'/api/v1/scenarios/'+created.id+'/sessions/'+encodeURIComponent(existingSession.id),
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{...editBody,editVersion:1,start:10}});
    assert.equal(approvedImmutable.statusCode,409,'Approved timetable must be immutable');
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
    // Structural records: program → versioned curriculum → cohort → normalized block → term-linked course.
    const program=await write('/programs',{departmentId:department.id,code:'PRG-'+uniq,name:'برنامج اصطناعي'});
    const plan=await write('/plans',{programId:program.id,code:'PLAN-'+uniq,versionLabel:'نسخة اختبار 1'});
    const planItem=await write('/plans/'+plan.id+'/items',{courseId:course.id,level:1,isRequired:true});
    assert.equal(planItem.level,1);
    const group=await write('/cohorts',{departmentId:department.id,programId:program.id,
      code:'GROUP-'+uniq,name:'فوج اختبار',level:1});
    const block=await write('/blocks',{cohortId:group.id,code:'B1',name:'البلوك الأول',size:20});
    const blockLink=await write('/assignments',{blockId:block.id,courseId:course.id,termId:term.id});
    assert.ok(blockLink.id);
    const demandSet=await app.inject({method:'PUT',url:'/api/v1/demand',headers:{cookie:session,'x-csrf-token':csrf},
      payload:{courseId:course.id,termId:term.id,baseStudents:19,repeatRate:0.05,source:'Synthetic admission forecast',confidence:'HIGH'}});
    assert.equal(demandSet.statusCode,200,demandSet.body);
    assert.equal(demandSet.json().projected_students,20);
    const structured=await write('/scenarios',{departmentId:department.id,termId:term.id,name:'بلوكات علائقية'});
    assert.equal(structured.result.sections.length,1);
    assert.equal(structured.result.sections[0].students,20);
    assert.equal(structured.result.sections[0].blockId,'GROUP-'+uniq+'::B1');
    const dashboard=await app.inject({url:'/api/v1/dashboard?departmentId='+department.id+'&termId='+term.id,
      headers:{cookie:session}});
    assert.equal(dashboard.statusCode,200,dashboard.body);
    assert.equal(dashboard.json().counts.programs,1);
    assert.equal(dashboard.json().counts.cohorts,1);
    assert.equal(dashboard.json().counts.blocks,1);
    assert.equal(dashboard.json().demand.projected,20);
    assert.equal(dashboard.json().demand.assignedBlocks,20);
    const structuredRow=await pool.query('SELECT input_snapshot FROM scenarios WHERE id=$1',[structured.id]);
    assert.deepEqual(structuredRow.rows[0]?.input_snapshot.courses[0].blockSizes,[20]);
    const mismatchSet=await app.inject({method:'PUT',url:'/api/v1/demand',headers:{cookie:session,'x-csrf-token':csrf},
      payload:{courseId:course.id,termId:term.id,baseStudents:20,repeatRate:0.05,source:'Synthetic revised forecast',confidence:'MEDIUM'}});
    assert.equal(mismatchSet.statusCode,200,mismatchSet.body);
    assert.equal(mismatchSet.json().projected_students,21);
    const mismatch=await app.inject({method:'POST',url:'/api/v1/scenarios',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{departmentId:department.id,termId:term.id,name:'يجب رفض عدم التطابق'}});
    assert.equal(mismatch.statusCode,409,'A scenario must reject inconsistent block totals');
    const prior=await pool.query('SELECT input_snapshot FROM scenarios WHERE id=$1',[structured.id]);
    assert.equal(prior.rows[0]?.input_snapshot.courses[0].demand,20,'saved snapshots cannot change with forecasts');

    const next=await write('/scenarios/'+created.id+'/revise',{});
    assert.equal(next.revision,2);
    const compare=await app.inject({url:'/api/v1/scenarios/compare?ids='+created.id+','+next.id,headers:{cookie:session}});
    assert.equal(compare.statusCode,200,compare.body);
    assert.equal(compare.json().first.sections,1);
    assert.equal(compare.json().second.sections,1);
  }finally{await app.close();await pool.end();}
});
