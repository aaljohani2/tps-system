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
    assert.ok(solve.runId,'Each optimization must persist its run identifier');
    const runHistory=await app.inject({url:'/api/v1/scenarios/'+created.id+'/runs',
      headers:{cookie:session}});
    assert.equal(runHistory.statusCode,200,runHistory.body);
    assert.equal(runHistory.json().length,1);
    assert.equal(runHistory.json()[0].status,'COMPLETED');
    assert.equal(runHistory.json()[0].id,solve.runId);
    assert.ok(runHistory.json()[0].elapsed_ms>=0);
    const cannotRecoverHealthy=await app.inject({method:'POST',
      url:'/api/v1/scenarios/'+created.id+'/runs/recover',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{}});
    assert.equal(cannotRecoverHealthy.statusCode,409,'A completed run cannot be marked abandoned');

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
    const advanced=await write('/courses',{departmentId:department.id,code:'ADV-102',
      title:'مقرر اصطناعي متقدم',level:2,theoryHours:2,practicalHours:0,demand:0});
    await write('/plans/'+plan.id+'/items',{courseId:advanced.id,level:2,isRequired:true});
    const prerequisite=await write('/prerequisites',{courseId:advanced.id,prerequisiteCourseId:course.id});
    assert.ok(prerequisite.id);
    const attemptedCycle=await app.inject({method:'POST',url:'/api/v1/prerequisites',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{courseId:course.id,prerequisiteCourseId:advanced.id}});
    assert.equal(attemptedCycle.statusCode,409,'A dependency cycle must be forbidden');
    const incompletePlan=await write('/plans',{programId:program.id,code:'INCOMPLETE-'+uniq,versionLabel:'Draft without prerequisite'});
    await write('/plans/'+incompletePlan.id+'/items',{courseId:advanced.id,level:2,isRequired:true});
    const cannotActivate=await app.inject({method:'POST',url:'/api/v1/plans/'+incompletePlan.id+'/activate',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{reason:'Incomplete synthetic plan'}});
    assert.equal(cannotActivate.statusCode,409,'Plan cannot omit a required prerequisite course');
    const activation=await write('/plans/'+plan.id+'/activate',{reason:'Synthetic internally approved curriculum version'});
    assert.equal(activation.state,'ACTIVE');
    const mutateActivatedPlan=await app.inject({method:'POST',url:'/api/v1/plans/'+plan.id+'/items',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{courseId:advanced.id,level:1,isRequired:true}});
    assert.equal(mutateActivatedPlan.statusCode,409,'Activated plan content is immutable');
    const cannotDeleteActivePrerequisite=await app.inject({method:'DELETE',
      url:'/api/v1/prerequisites/'+prerequisite.id,
      headers:{cookie:session,'x-csrf-token':csrf}});
    assert.equal(cannotDeleteActivePrerequisite.statusCode,409,
      'Removing an active plan prerequisite must be forbidden');
    const cannotUpsertActivePrerequisite=await app.inject({method:'POST',
      url:'/api/v1/prerequisites',headers:{cookie:session,'x-csrf-token':csrf},
      payload:{courseId:advanced.id,prerequisiteCourseId:course.id}});
    assert.equal(cannotUpsertActivePrerequisite.statusCode,409,
      'Active plan relationships are immutable even for existing prerequisite links');
    const duplicateActivation=await app.inject({method:'POST',
      url:'/api/v1/plans/'+plan.id+'/activate',headers:{cookie:session,'x-csrf-token':csrf},
      payload:{reason:'Already activated earlier'}});
    assert.equal(duplicateActivation.statusCode,409,'An active plan cannot be activated again');

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
    assert.deepEqual(structuredRow.rows[0]?.input_snapshot.courses.find((c:{code:string})=>c.code==='TEST-101')?.blockSizes,[20]);
    const unsafeNormalizedFork=await app.inject({method:'POST',
      url:'/api/v1/scenarios/'+structured.id+'/fork',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{name:'Unsupported block change',overrides:[
        {code:'TEST-101',demand:40,blocks:['GROUP-'+uniq+'::B1','GROUP-'+uniq+'::B2']}
      ]}});
    assert.equal(unsafeNormalizedFork.statusCode,400,'Changing a normalized block requires exact sizes');
    const normalizedFork=await write('/scenarios/'+structured.id+'/fork',{
      name:'Synthetic cohort expansion',overrides:[
        {code:'TEST-101',demand:40,blocks:['GROUP-'+uniq+'::B1','GROUP-'+uniq+'::B2'],
          blockSizes:[20,20]}
      ]});
    assert.deepEqual(normalizedFork.result.sections.map((x:{students:number})=>x.students),[20,20]);
    const mismatchSet=await app.inject({method:'PUT',url:'/api/v1/demand',headers:{cookie:session,'x-csrf-token':csrf},
      payload:{courseId:course.id,termId:term.id,baseStudents:20,repeatRate:0.05,source:'Synthetic revised forecast',confidence:'MEDIUM'}});
    assert.equal(mismatchSet.statusCode,200,mismatchSet.body);
    assert.equal(mismatchSet.json().projected_students,21);
    const mismatch=await app.inject({method:'POST',url:'/api/v1/scenarios',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{departmentId:department.id,termId:term.id,name:'يجب رفض عدم التطابق'}});
    assert.equal(mismatch.statusCode,409,'A scenario must reject inconsistent block totals');
    const prior=await pool.query('SELECT input_snapshot FROM scenarios WHERE id=$1',[structured.id]);
    assert.equal(prior.rows[0]?.input_snapshot.courses.find((c:{code:string})=>c.code==='TEST-101')?.demand,20,'saved snapshots cannot change with forecasts');


    // CSV bulk flow: preview, error feedback, exact-file transaction and anti-replay.
    const scope='departmentId='+department.id+'&termId='+term.id;
    const batchHeaders={cookie:session,'x-csrf-token':csrf,'content-type':'text/csv'};
    const csvUpload=(kind:string,stage:string,csv:string,extra='')=>app.inject({
      method:'POST',url:'/api/v1/import/batch/'+kind+'/'+stage+'?'+scope+extra,
      headers:batchHeaders,payload:Buffer.from(csv,'utf8')
    });
    const invalidResource=await csvUpload('rooms','preview',
      'code,name,type,capacity,building,available\\nR-IMP,Bad room,LAB,0,B1,\\n');
    assert.equal(invalidResource.statusCode,200,invalidResource.body);
    assert.equal(invalidResource.json().ready,false);
    assert.equal(invalidResource.json().importId,null);
    assert.equal(invalidResource.json().errors[0].row,2);
    const safeCsv='code,name,type,capacity,building,available\\nR-IMP-'+uniq+',قاعة دفعة,CLASSROOM,36,B1,\\n';
    const beforeImport=await pool.query('SELECT count(*)::int AS n FROM rooms WHERE college_id=$1',[college.id]);
    const roomPreview=await csvUpload('rooms','preview',safeCsv);
    assert.equal(roomPreview.statusCode,200,roomPreview.body);
    assert.equal(roomPreview.json().ready,true);
    const afterPreview=await pool.query('SELECT count(*)::int AS n FROM rooms WHERE college_id=$1',[college.id]);
    assert.equal(afterPreview.rows[0].n,beforeImport.rows[0].n,'Preview must never write records');
    const tampered=await csvUpload('rooms','commit',
      safeCsv.replace('قاعة دفعة','قاعة أخرى'),'&importId='+roomPreview.json().importId);
    assert.equal(tampered.statusCode,409,'Import commit must match the previewed file bytes');
    const roomCommit=await csvUpload('rooms','commit',safeCsv,'&importId='+roomPreview.json().importId);
    assert.equal(roomCommit.statusCode,200,roomCommit.body);
    assert.equal(roomCommit.json().status,'COMMITTED');
    assert.equal(roomCommit.json().imported,1);
    const replay=await csvUpload('rooms','commit',safeCsv,'&importId='+roomPreview.json().importId);
    assert.equal(replay.statusCode,409,'A preview can be committed once only');
    const roomRecord=await pool.query('SELECT capacity FROM rooms WHERE college_id=$1 AND code=$2',
      [college.id,'R-IMP-'+uniq]);
    assert.equal(roomRecord.rows[0].capacity,36);
    const noSharedRoomImport=await app.inject({method:'POST',
      url:'/api/v1/import/batch/rooms/preview?'+scope,
      headers:{cookie:limitedCookie,'x-csrf-token':limitedCsrf,'content-type':'text/csv'},
      payload:Buffer.from(safeCsv)});
    assert.equal(noSharedRoomImport.statusCode,403,'Department head cannot import shared college rooms');
    const noCSRFImport=await app.inject({method:'POST',
      url:'/api/v1/import/batch/rooms/preview?'+scope,
      headers:{cookie:session,'content-type':'text/csv'},payload:Buffer.from(safeCsv)});
    assert.equal(noCSRFImport.statusCode,403);
    const xlsxTemplate=await app.inject({
      url:'/api/v1/import/batch/instructors/template.xlsx',headers:{cookie:session}});
    assert.equal(xlsxTemplate.statusCode,200,xlsxTemplate.body);
    assert.equal(xlsxTemplate.rawPayload.subarray(0,2).toString('ascii'),'PK');
    const trainerCsv='code,name,maxLoad,eligibleCourseCodes,allowedModes,available\\nI-IMP-'+uniq+
      ',مدرب اصطناعي للدفعة,18,TEST-101,ONSITE,\\n';
    const trainerPreview=await csvUpload('instructors','preview',trainerCsv);
    assert.equal(trainerPreview.statusCode,200,trainerPreview.body);
    const trainerCommit=await csvUpload('instructors','commit',trainerCsv,
      '&importId='+trainerPreview.json().importId);
    assert.equal(trainerCommit.statusCode,200,trainerCommit.body);
    const trainerImport=await pool.query('SELECT overload,max_load FROM instructors WHERE department_id=$1 AND code=$2',
      [department.id,'I-IMP-'+uniq]);
    assert.equal(trainerImport.rowCount,1);
    assert.equal(trainerImport.rows[0].overload,null,'Bulk import cannot approve overload');
    const blockCsv='cohortCode,code,name,size,courseCodes\\nGROUP-'+uniq+
      ',B-IMP,بلوك تجريبي,10,TEST-101\\n';
    const blockPreview=await csvUpload('blocks','preview',blockCsv);
    assert.equal(blockPreview.statusCode,200,blockPreview.body);
    const blockCommit=await csvUpload('blocks','commit',blockCsv,
      '&importId='+blockPreview.json().importId);
    assert.equal(blockCommit.statusCode,200,blockCommit.body);
    const blockPersisted=await pool.query(`SELECT b.size FROM student_blocks b JOIN cohorts co ON co.id=b.cohort_id
      WHERE co.department_id=$1 AND co.code=$2 AND b.code='B-IMP'`,[department.id,'GROUP-'+uniq]);
    assert.equal(blockPersisted.rows[0].size,10);
    const demandCsv='courseCode,level,baseStudents,repeatRate,source,confidence\\nADV-102,2,0,0.05,Academic forecast,HIGH\\n';
    const demandPreview=await csvUpload('demand','preview',demandCsv);
    assert.equal(demandPreview.statusCode,200,demandPreview.body);
    const demandCommit=await csvUpload('demand','commit',demandCsv,
      '&importId='+demandPreview.json().importId);
    assert.equal(demandCommit.statusCode,200,demandCommit.body);
    const demandRecord=await pool.query('SELECT source FROM demand_estimates WHERE course_id=$1 AND term_id=$2',
      [advanced.id,term.id]);
    assert.equal(demandRecord.rows[0].source,'Academic forecast');
    const committedJobs=await pool.query(`SELECT count(*)::int AS n FROM import_jobs
      WHERE created_by=(SELECT id FROM users WHERE username=$1) AND status='COMMITTED'`,[username]);
    assert.equal(committedJobs.rows[0].n,4);

    const next=await write('/scenarios/'+created.id+'/revise',{});
    assert.equal(next.revision,2);
    const compare=await app.inject({url:'/api/v1/scenarios/compare?ids='+created.id+','+next.id,headers:{cookie:session}});
    assert.equal(compare.statusCode,200,compare.body);
    assert.equal(compare.json().first.sections,1);
    assert.equal(compare.json().second.sections,1);
  }finally{await app.close();await pool.end();}
});
