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
    const specialist=await patch('/instructors/'+trainer.id,{specialties:['ERP']});
    assert.deepEqual(specialist.specialties,['ERP']);
    const equipped=await patch('/rooms/'+room.id,{equipmentCodes:['PC']});
    assert.deepEqual(equipped.equipmentCodes,['PC']);
    const qualifiedCourse=await patch('/courses/'+course.id,
      {requiredSpecialties:['ERP'],requiredEquipment:['PC']});
    assert.deepEqual(qualifiedCourse.requiredSpecialties,['ERP']);
    assert.deepEqual(qualifiedCourse.requiredEquipment,['PC']);
    const wrongSpecialtyLock=await app.inject({method:'PATCH',url:'/api/v1/courses/'+course.id,
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{assignedInstructorId:'INS-1',requiredSpecialties:['NETWORK']}});
    assert.equal(wrongSpecialtyLock.statusCode,409,
      'A locked instructor cannot acquire qualifications merely through a course edit');
    const authorizedLock=await patch('/courses/'+course.id,{assignedInstructorId:'INS-1'});
    assert.equal(authorizedLock.assignedInstructorId,'INS-1');
    const illegalLaterSpecialty=await app.inject({method:'PATCH',url:'/api/v1/courses/'+course.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{requiredSpecialties:['NETWORK']}});
    assert.equal(illegalLaterSpecialty.statusCode,409,
      'Changing requirements must revalidate an already-locked instructor');

    const invalidEquipment=await app.inject({method:'PATCH',url:'/api/v1/courses/'+course.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{requiredEquipment:['PC','PC']}});
    assert.equal(invalidEquipment.statusCode,400,'Duplicate equipment codes must fail validation');
    const unauthorizedEquip=await app.inject({method:'PATCH',url:'/api/v1/rooms/'+room.id,
      headers:{cookie:limitedCookie,'x-csrf-token':limitedCsrf},payload:{equipmentCodes:[]}});
    assert.equal(unauthorizedEquip.statusCode,403,'A department role must not remove shared room equipment');

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
    // PATCH must not materialize Zod v4 defaults for omitted fields.
    const preserved=await pool.query(
      'SELECT blocks,required_specialties,required_equipment FROM courses WHERE id=$1',[course.id]);
    assert.deepEqual(preserved.rows[0].blocks,['BLK-1'],
      'Changing mode, requirements or instructor must never silently clear course blocks');
    assert.deepEqual(preserved.rows[0].required_specialties,['ERP']);
    assert.deepEqual(preserved.rows[0].required_equipment,['PC']);
    const preservedTrainer=await pool.query('SELECT allowed_modes,specialties FROM instructors WHERE id=$1',[trainer.id]);
    assert.deepEqual(preservedTrainer.rows[0].allowed_modes,['ONSITE','REMOTE']);
    assert.deepEqual(preservedTrainer.rows[0].specialties,['ERP']);
    const preservedRoom=await pool.query('SELECT equipment_codes FROM rooms WHERE id=$1',[room.id]);
    assert.deepEqual(preservedRoom.rows[0].equipment_codes,['PC']);


    const invalidWindow=await app.inject({method:'PATCH',url:'/api/v1/rooms/'+room.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{available:[{day:'THU',from:8,to:12}]}});
    assert.equal(invalidWindow.statusCode,400,'Thursday room availability must respect schedule limits');

    const injectedPolicy=await app.inject({method:'POST',url:'/api/v1/scenarios',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{departmentId:department.id,termId:term.id,name:'Override attempt',policy:{enabledModes:['HYBRID']}}});
    assert.equal(injectedPolicy.statusCode,400,'Policy override must be rejected');
    const created=await write('/scenarios',{departmentId:department.id,termId:term.id,name:'مسودة اصطناعية'});
    assert.equal(created.result.metrics.sectionCount,1);
    // Archival is reversible and audited; no saved or approved snapshots are destroyed.
    const beforeArchive=await pool.query('SELECT input_snapshot,result_snapshot FROM scenarios WHERE id=$1',[created.id]);
    const archivedRoom=await app.inject({method:'PATCH',
      url:'/api/v1/rooms/'+room.id+'/lifecycle',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{active:false,reason:'Synthetic test classroom maintenance'}});
    assert.equal(archivedRoom.statusCode,200,archivedRoom.body);
    assert.equal(archivedRoom.json().is_active,false);
    const deniedArchive=await app.inject({method:'PATCH',
      url:'/api/v1/rooms/'+room.id+'/lifecycle',
      headers:{cookie:limitedCookie,'x-csrf-token':limitedCsrf},
      payload:{active:true,reason:'Unauthorized shared room activation'}});
    assert.equal(deniedArchive.statusCode,403);
    const noRoomScenario=await write('/scenarios',{departmentId:department.id,termId:term.id,
      name:'Synthetic archived room'});
    assert.equal(noRoomScenario.result.gaps[0]?.reason,'NO_FEASIBLE_TIMETABLE',
      'Inactive shared room must not appear in newly generated planning inputs');
    const archivedVisible=await app.inject({url:'/api/v1/rooms?collegeId='+college.id+
      '&includeArchived=true',headers:{cookie:session}});
    assert.equal(archivedVisible.statusCode,200);
    assert.ok(archivedVisible.json().some((x:{id:string;active:boolean})=>x.id===room.id&&!x.active));
    const activeRooms=await app.inject({url:'/api/v1/rooms?collegeId='+college.id,
      headers:{cookie:session}});
    assert.ok(!activeRooms.json().some((x:{id:string})=>x.id===room.id));
    const restoredRoom=await app.inject({method:'PATCH',
      url:'/api/v1/rooms/'+room.id+'/lifecycle',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{active:true,reason:'Synthetic classroom maintenance complete'}});
    assert.equal(restoredRoom.statusCode,200,restoredRoom.body);
    const archivedTrainer=await app.inject({method:'PATCH',
      url:'/api/v1/instructors/'+trainer.id+'/lifecycle',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{active:false,reason:'Synthetic trainer temporary deactivation'}});
    assert.equal(archivedTrainer.statusCode,200,archivedTrainer.body);
    const noTrainerScenario=await app.inject({method:'POST',url:'/api/v1/scenarios',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{
        departmentId:department.id,termId:term.id,name:'Synthetic archived locked trainer'
      }});
    assert.equal(noTrainerScenario.statusCode,409,
      'An archived locked trainer requires explicit restoration or reassignment before scheduling');
    const restoredTrainer=await app.inject({method:'PATCH',
      url:'/api/v1/instructors/'+trainer.id+'/lifecycle',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{active:true,reason:'Synthetic trainer reinstatement approval'}});
    assert.equal(restoredTrainer.statusCode,200,restoredTrainer.body);
    const courseArchived=await app.inject({method:'PATCH',
      url:'/api/v1/courses/'+course.id+'/lifecycle',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{active:false,reason:'Synthetic deprecated course for archival test'}});
    assert.equal(courseArchived.statusCode,200,courseArchived.body);
    const inactiveCourses=await app.inject({url:'/api/v1/courses?departmentId='+department.id,
      headers:{cookie:session}});
    assert.ok(!inactiveCourses.json().some((x:{id:string})=>x.id===course.id));
    const hiddenCourseScenario=await app.inject({method:'POST',url:'/api/v1/scenarios',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{
        departmentId:department.id,termId:term.id,name:'Synthetic archived course not scheduled'
      }});
    assert.equal(hiddenCourseScenario.statusCode,400,
      'Inactive courses must not reappear in future scenarios');
    const courseRestored=await app.inject({method:'PATCH',
      url:'/api/v1/courses/'+course.id+'/lifecycle',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{active:true,reason:'Synthetic course restoration approved'}});
    assert.equal(courseRestored.statusCode,200,courseRestored.body);
    const snapshotAfter=await pool.query('SELECT input_snapshot,result_snapshot FROM scenarios WHERE id=$1',[created.id]);
    assert.deepEqual(snapshotAfter.rows[0],beforeArchive.rows[0],
      'Historical scenario snapshots must remain unchanged after archiving resources');
    const archiveAudit=await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='ARCHIVE_ROOM' AND entity_id=$1",
      [room.id]);
    assert.equal(archiveAudit.rows[0]?.n,1);

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

    const pageSearch=await app.inject({url:'/api/v1/scenarios?departmentId='+department.id+
      '&termId='+term.id+'&limit=1&offset=0&search='+encodeURIComponent('مسودة اصطناعية'),
      headers:{cookie:session}});
    assert.equal(pageSearch.statusCode,200,pageSearch.body);
    assert.equal(pageSearch.json().length,1);
    assert.equal(pageSearch.json()[0].id,created.id,'Scoped search must find the exact scenario');
    const emptyPage=await app.inject({url:'/api/v1/scenarios?departmentId='+department.id+
      '&termId='+term.id+'&limit=1&offset=9999',headers:{cookie:session}});
    assert.equal(emptyPage.statusCode,200);
    assert.deepEqual(emptyPage.json(),[],'Offset beyond result set returns an empty array');
    const pageTooLarge=await app.inject({url:'/api/v1/scenarios?departmentId='+department.id+
      '&limit=101',headers:{cookie:session}});
    assert.equal(pageTooLarge.statusCode,400,'Page size must be bounded');
    const pageOutOfScope=await app.inject({url:'/api/v1/scenarios?departmentId='+sibling.id+
      '&limit=10',headers:{cookie:limitedCookie}});
    assert.equal(pageOutOfScope.statusCode,403,'Paging must not bypass department scope');

    const cancelWithoutCsrf=await app.inject({method:'POST',
      url:'/api/v1/scenarios/'+created.id+'/runs/cancel',headers:{cookie:session},payload:{}});
    assert.equal(cancelWithoutCsrf.statusCode,403,'Solver cancellation must require CSRF');
    const cancelWithoutRunning=await app.inject({method:'POST',
      url:'/api/v1/scenarios/'+created.id+'/runs/cancel',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{}});
    assert.equal(cancelWithoutRunning.statusCode,409,'A non-running draft must never be cancelled');
    const invalidSeconds=await app.inject({method:'POST',
      url:'/api/v1/scenarios/'+created.id+'/solve',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{seconds:31}});
    assert.equal(invalidSeconds.statusCode,400,'Solver duration cap must be validated before claiming a run');
    const invalidCandidates=await app.inject({method:'POST',
      url:'/api/v1/scenarios/'+created.id+'/solve',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{candidatesPerInstructor:25}});
    assert.equal(invalidCandidates.statusCode,400,'Solver candidate cap must be enforced');
    const noClaim=await pool.query('SELECT solver_status FROM scenarios WHERE id=$1',[created.id]);
    assert.equal(noClaim.rows[0]?.solver_status,'NOT_RUN','Invalid settings must not reserve the solver');
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

    // HTTP-independent execution: request returns 202 with an already-durable
    // run ID, then its stages and eventual result remain observable via API.
    const asyncDraft=await write('/scenarios',{departmentId:department.id,termId:term.id,
      name:'Synthetic detached Timefold execution'});
    const asyncStart=await app.inject({method:'POST',
      url:'/api/v1/scenarios/'+asyncDraft.id+'/solve/async',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{seconds:1,candidatesPerInstructor:4}});
    assert.equal(asyncStart.statusCode,202,asyncStart.body);
    assert.equal(asyncStart.json().accepted,true);
    const detachedRunId=asyncStart.json().runId;
    const persistedStart=await pool.query(
      'SELECT status,progress_stage,requested_settings FROM solver_runs WHERE id=$1',[detachedRunId]);
    assert.equal(persistedStart.rowCount,1,'Accepted async run must be durable before response');
    assert.equal(persistedStart.rows[0].requested_settings.seconds,1);
    const duplicateAsync=await app.inject({method:'POST',
      url:'/api/v1/scenarios/'+asyncDraft.id+'/solve/async',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{}});
    assert.equal(duplicateAsync.statusCode,409,'Duplicate detached solve must fail');
    let asyncFinal='RUNNING';
    for(let attempt=0;attempt<90;attempt++){
      const current=await pool.query('SELECT status FROM solver_runs WHERE id=$1',[detachedRunId]);
      asyncFinal=current.rows[0]?.status??'MISSING';
      if(asyncFinal!=='RUNNING')break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(asyncFinal,'COMPLETED','Detached Java process must finish after HTTP 202');
    const detachedRecord=await pool.query(
      'SELECT solver_status,result_snapshot FROM scenarios WHERE id=$1',[asyncDraft.id]);
    assert.equal(detachedRecord.rows[0].solver_status,'COMPLETED');
    assert.ok(detachedRecord.rows[0].result_snapshot.metrics.sectionCount>=1);
    const detachedHistory=await app.inject({url:'/api/v1/scenarios/'+asyncDraft.id+'/runs',
      headers:{cookie:session}});
    assert.equal(detachedHistory.statusCode,200);
    assert.equal(detachedHistory.json()[0].progress_stage,'COMPLETED');

    // A cancellation is transactionally committed before the detached worker
    // can save a result. Its previous draft must remain unchanged.
    const cancelDraft=await write('/scenarios',{departmentId:department.id,termId:term.id,
      name:'Synthetic cancellable Timefold execution'});
    const initialSnapshot=await pool.query('SELECT result_snapshot FROM scenarios WHERE id=$1',[cancelDraft.id]);
    const cancellable=await app.inject({method:'POST',
      url:'/api/v1/scenarios/'+cancelDraft.id+'/solve/async',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{seconds:25,candidatesPerInstructor:4}});
    assert.equal(cancellable.statusCode,202,cancellable.body);
    const cancelled=await app.inject({method:'POST',
      url:'/api/v1/scenarios/'+cancelDraft.id+'/runs/cancel',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{}});
    assert.equal(cancelled.statusCode,200,cancelled.body);
    assert.equal(cancelled.json().runId,cancellable.json().runId);
    await new Promise(resolve=>setTimeout(resolve,250));
    const cancelledRecord=await pool.query(
      'SELECT status,progress_stage FROM solver_runs WHERE id=$1',[cancellable.json().runId]);
    assert.equal(cancelledRecord.rows[0].status,'CANCELLED');
    assert.equal(cancelledRecord.rows[0].progress_stage,'CANCELLED');
    const cancelledScenario=await pool.query(
      'SELECT solver_status,result_snapshot FROM scenarios WHERE id=$1',[cancelDraft.id]);
    assert.equal(cancelledScenario.rows[0].solver_status,'FAILED');
    assert.deepEqual(cancelledScenario.rows[0].result_snapshot,initialSnapshot.rows[0].result_snapshot,
      'Cancelling must not overwrite or approve a partial schedule');
    const cancelAudit=await pool.query(
      "SELECT id FROM audit_logs WHERE action='CANCEL_SOLVER' AND entity_id=$1",[cancelDraft.id]);
    assert.equal(cancelAudit.rowCount,1);

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
    const comparisonXlsx=await app.inject({url:'/api/v1/scenarios/'+created.id+
      '/export.xlsx?compareId='+fork.id,headers:{cookie:session}});
    assert.equal(comparisonXlsx.statusCode,200,comparisonXlsx.body);
    assert.equal(comparisonXlsx.rawPayload.subarray(0,2).toString('ascii'),'PK');
    const forkRecord=await pool.query('SELECT parent_scenario_id,solver_status FROM scenarios WHERE id=$1',[fork.id]);
    assert.equal(forkRecord.rows[0]?.parent_scenario_id,created.id);
    assert.equal(forkRecord.rows[0]?.solver_status,'NOT_RUN');
    // Structural records: program → versioned curriculum → cohort → normalized block → term-linked course.
    const program=await write('/programs',{departmentId:department.id,code:'PRG-'+uniq,name:'برنامج اصطناعي'});
    const automaticCsv=Buffer.from([
      'code,title,level,theory hours,practical hours,tutorial hours,credits,alternative group,responsible department',
      'AUTO-'+uniq+',Automatic regular course,المستوى الأول,3,0,1,4,,Business',
      'COOP-'+uniq+',التدريب التعاوني,المستوى الخامس,0,0,0,6,LEVEL-5-PATH,Business',
      'PROJ-'+uniq+',المشروع الإنتاجي,المستوى الخامس,0,0,0,6,LEVEL-5-PATH,Business'
    ].join('\n'),'utf8');
    const mismatchedAutomaticCsv=Buffer.from([
      'code,title,level,theory hours,practical hours,tutorial hours,credits,department',
      'WRONG-'+uniq+',Wrong department course,1,2,0,0,2,Another Department'
    ].join('\n'),'utf8');
    const mismatchedAutomaticSave=await app.inject({method:'POST',
      url:'/api/v1/automatic-planning/plan/commit?departmentId='+department.id+'&programId='+program.id+
        '&planCode=WRONG-'+uniq+'&versionLabel=Wrong%20department',
      headers:{cookie:session,'x-csrf-token':csrf,'content-type':'text/csv'},payload:mismatchedAutomaticCsv});
    assert.equal(mismatchedAutomaticSave.statusCode,409,'Detected department must match the selected department');
    const automaticSave=await app.inject({method:'POST',
      url:'/api/v1/automatic-planning/plan/commit?departmentId='+department.id+'&programId='+program.id+
        '&planCode=AUTO-'+uniq+'&versionLabel=Automatic%20test%20version',
      headers:{cookie:session,'x-csrf-token':csrf,'content-type':'text/csv'},payload:automaticCsv});
    assert.equal(automaticSave.statusCode,200,automaticSave.body);
    assert.equal(automaticSave.json().records,3);
    assert.equal(automaticSave.json().state,'DRAFT');
    const traineeCsv=Buffer.from([
      'student id,course code,day',
      '1001,AUTO-'+uniq+',Sunday',
      '1001,AUTO-'+uniq+',Tuesday',
      '1002,AUTO-'+uniq+',Monday'
    ].join('\n'),'utf8');
    const traineePreview=await app.inject({method:'POST',url:'/api/v1/automatic-planning/history/preview?departmentId='+
      department.id+'&courseLevels='+encodeURIComponent(JSON.stringify({['AUTO-'+uniq]:1})),
      headers:{cookie:session,'x-csrf-token':csrf,'content-type':'text/csv'},payload:traineeCsv});
    assert.equal(traineePreview.statusCode,200,traineePreview.body);
    assert.deepEqual(traineePreview.json().counts,{1:2});
    assert.equal(traineePreview.json().detection.uniqueTrainees,2);
    assert.equal(traineePreview.json().detection.matchedRows,3);
    assert.equal(traineePreview.json().courseCount,1);
    const materialized=await app.inject({method:'POST',url:'/api/v1/automatic-planning/materialize?departmentId='+department.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{planId:automaticSave.json().planId,termId:term.id,
        scenarioName:'Automatic integrated scenario',sources:[{kind:'COURSE_REGISTRATIONS',counts:{1:2,5:1},
          label:'Synthetic trainee registrations',confidence:'HIGH',isConfirmedForTarget:true}],
        capacities:{remoteTheory:100,onsiteTheory:50,practical:40,mixed:40},settings:[],
        alternativeSelections:{'LEVEL-5-PATH':'COOP-'+uniq}}});
    assert.equal(materialized.statusCode,200,materialized.body);
    assert.equal(materialized.json().demandRecords,2);
    assert.equal(materialized.json().cohorts,2);
    assert.equal(materialized.json().blocks,2);
    assert.equal(materialized.json().assignments,1);
    assert.ok(materialized.json().scenarioId,materialized.body);
    const integratedRows=await pool.query(`SELECT
      (SELECT count(*)::int FROM demand_estimates WHERE source=$1) AS demand,
      (SELECT count(*)::int FROM cohorts WHERE department_id=$2 AND code LIKE $3) AS cohorts,
      (SELECT count(*)::int FROM student_blocks b JOIN cohorts c ON c.id=b.cohort_id
        WHERE c.department_id=$2 AND c.code LIKE $3) AS blocks`,[
      'TPS_AUTO:'+automaticSave.json().planId,department.id,
      'AUTO-'+automaticSave.json().planId.slice(0,8)+'-'+term.id.slice(0,8)+'-%']);
    assert.deepEqual(integratedRows.rows[0],{demand:2,cohorts:2,blocks:2});
    // Simulate review of the generated scenario: even though immutable snapshots
    // survive, live cohort/block IDs must not be replaced by a repeat import.
    await pool.query("UPDATE scenarios SET state='UNDER_REVIEW' WHERE id=$1",[materialized.json().scenarioId]);
    const reimportProtected=await app.inject({method:'POST',
      url:'/api/v1/automatic-planning/materialize?departmentId='+department.id,
      headers:{cookie:session,'x-csrf-token':csrf},payload:{planId:automaticSave.json().planId,termId:term.id,
        scenarioName:'Unsafe reimport while under review',sources:[{kind:'COURSE_REGISTRATIONS',counts:{1:2,5:1},
          label:'Synthetic trainee registrations',confidence:'HIGH',isConfirmedForTarget:true}],
        capacities:{remoteTheory:100,onsiteTheory:50,practical:40,mixed:40},settings:[],
        alternativeSelections:{'LEVEL-5-PATH':'COOP-'+uniq}}});
    assert.equal(reimportProtected.statusCode,409,'A scenario under review must preserve its existing generated blocks');
    const protectedRows=await pool.query(`SELECT
      (SELECT count(*)::int FROM cohorts WHERE department_id=$1 AND code LIKE $2) AS cohorts,
      (SELECT count(*)::int FROM student_blocks b JOIN cohorts c ON c.id=b.cohort_id
        WHERE c.department_id=$1 AND c.code LIKE $2) AS blocks`,[
      department.id,'AUTO-'+automaticSave.json().planId.slice(0,8)+'-'+term.id.slice(0,8)+'-%']);
    assert.deepEqual(protectedRows.rows[0],{cohorts:2,blocks:2},
      'Protected re-import must not delete or alter existing cohort blocks');
    await pool.query("UPDATE scenarios SET state='DRAFT' WHERE id=$1",[materialized.json().scenarioId]);
    const smartTrainerCsv=Buffer.from([
      'الفصل التدريبي,الوحدة التدريبية,القسم,رقم المدرب,اسم المدرب,المقرر,وصف المحاضرة',
      `1448,كلية اختبار,${department.name},AUTO-I-${uniq},مدرب استيراد ذكي,AUTO-${uniq},نظري صباحي`,
      `1448,كلية اختبار,قسم آخر,OTHER-I-${uniq},مدرب قسم آخر,AUTO-${uniq},عملي`
    ].join('\n'),'utf8');
    const smartTrainerPreview=await app.inject({method:'POST',
      url:'/api/v1/automatic-planning/resources/preview?departmentId='+department.id,
      headers:{cookie:session,'x-csrf-token':csrf,'content-type':'text/csv'},payload:smartTrainerCsv});
    assert.equal(smartTrainerPreview.statusCode,200,smartTrainerPreview.body);
    assert.equal(smartTrainerPreview.json().instructors,1);
    assert.equal(smartTrainerPreview.json().courseLinkedInstructors,1);
    assert.equal(smartTrainerPreview.json().ready,true);
    const smartTrainerCommit=await app.inject({method:'POST',
      url:'/api/v1/automatic-planning/resources/commit?departmentId='+department.id+
        '&expectedSha256='+smartTrainerPreview.json().sha256+'&defaultMaxLoad=18',
      headers:{cookie:session,'x-csrf-token':csrf,'content-type':'text/csv'},payload:smartTrainerCsv});
    assert.equal(smartTrainerCommit.statusCode,200,smartTrainerCommit.body);
    assert.deepEqual({imported:smartTrainerCommit.json().imported,skipped:smartTrainerCommit.json().skipped},{imported:1,skipped:0});
    const smartTrainer=await pool.query('SELECT max_load,eligible_course_codes,available FROM instructors WHERE department_id=$1 AND code=$2',
      [department.id,'AUTO-I-'+uniq]);
    assert.equal(Number(smartTrainer.rows[0]?.max_load),18);
    assert.deepEqual(smartTrainer.rows[0]?.eligible_course_codes,['AUTO-'+uniq.toUpperCase()]);
    assert.equal(smartTrainer.rows[0]?.available,null);
    const duplicateTrainerImport=await app.inject({method:'POST',
      url:'/api/v1/automatic-planning/resources/commit?departmentId='+department.id+
        '&expectedSha256='+smartTrainerPreview.json().sha256+'&defaultMaxLoad=18',
      headers:{cookie:session,'x-csrf-token':csrf,'content-type':'text/csv'},payload:smartTrainerCsv});
    assert.equal(duplicateTrainerImport.statusCode,409,
      'Repeated timetable import must not overwrite an existing instructor or grant new modes');
    const trainerStillOnsite=await pool.query('SELECT allowed_modes,eligible_course_codes FROM instructors WHERE department_id=$1 AND code=$2',[
      department.id,'AUTO-I-'+uniq]);
    assert.deepEqual(trainerStillOnsite.rows[0]?.allowed_modes,['ONSITE'],
      'Historical online timetable is not proof of ongoing REMOTE authorization');
    assert.deepEqual(trainerStillOnsite.rows[0]?.eligible_course_codes,['AUTO-'+uniq.toUpperCase()]);
    await pool.query('DELETE FROM instructors WHERE department_id=$1 AND code=$2',[department.id,'AUTO-I-'+uniq]);
    // Keep the materialization verification isolated from the structural workflow below. The
    // imported plan remains available for its lifecycle assertions, while its generated term
    // demand/blocks and legacy demand projection must not become implicit input to later scenarios.
    await pool.query('DELETE FROM scenarios WHERE id=$1',[materialized.json().scenarioId]);
    await pool.query(`DELETE FROM block_course_assignments WHERE block_id IN (
      SELECT b.id FROM student_blocks b JOIN cohorts c ON c.id=b.cohort_id
      WHERE c.department_id=$1 AND c.code LIKE $2)`,[department.id,
      'AUTO-'+automaticSave.json().planId.slice(0,8)+'-'+term.id.slice(0,8)+'-%']);
    await pool.query(`DELETE FROM student_blocks WHERE cohort_id IN (
      SELECT id FROM cohorts WHERE department_id=$1 AND code LIKE $2)`,[department.id,
      'AUTO-'+automaticSave.json().planId.slice(0,8)+'-'+term.id.slice(0,8)+'-%']);
    await pool.query('DELETE FROM cohorts WHERE department_id=$1 AND code LIKE $2',[department.id,
      'AUTO-'+automaticSave.json().planId.slice(0,8)+'-'+term.id.slice(0,8)+'-%']);
    await pool.query('DELETE FROM demand_estimates WHERE source=$1',['TPS_AUTO:'+automaticSave.json().planId]);
    await pool.query('DELETE FROM level_demand_sources WHERE program_id=$1 AND term_id=$2',[program.id,term.id]);
    await pool.query(`UPDATE courses SET demand=0 WHERE id IN (
      SELECT course_id FROM curriculum_items WHERE plan_id=$1)`,[automaticSave.json().planId]);
    const automaticRows=await pool.query(`SELECT cp.state,count(ci.id)::int AS items,
      count(*) FILTER(WHERE c.is_non_timetabled)::int AS non_timed
      FROM curriculum_plans cp JOIN curriculum_items ci ON ci.plan_id=cp.id
      JOIN courses c ON c.id=ci.course_id WHERE cp.id=$1 GROUP BY cp.state`,[automaticSave.json().planId]);
    assert.deepEqual(automaticRows.rows[0],{state:'DRAFT',items:3,non_timed:2});
    const duplicateAutomatic=await app.inject({method:'POST',
      url:'/api/v1/automatic-planning/plan/commit?departmentId='+department.id+'&programId='+program.id+
        '&planCode=AUTO-'+uniq+'&versionLabel=Duplicate',
      headers:{cookie:session,'x-csrf-token':csrf,'content-type':'text/csv'},payload:automaticCsv});
    assert.equal(duplicateAutomatic.statusCode,409,'A version import must never overwrite an existing plan code');
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
    const archivalCourse=await write('/courses',{departmentId:department.id,code:'ARCH-199',
      title:'مقرر أرشفة تجريبي',level:1,theoryHours:2,practicalHours:0,demand:0});
    const archivalPlan=await write('/plans',{programId:program.id,code:'ARCHIVED-'+uniq,
      versionLabel:'خطة مع مقرر مؤرشف'});
    await write('/plans/'+archivalPlan.id+'/items',{courseId:archivalCourse.id,level:1,isRequired:true});
    const archivedBeforeActivate=await app.inject({method:'PATCH',
      url:'/api/v1/courses/'+archivalCourse.id+'/lifecycle',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{active:false,reason:'Archive course before plan activation'}});
    assert.equal(archivedBeforeActivate.statusCode,200);
    const cannotActivateArchivedCourse=await app.inject({method:'POST',
      url:'/api/v1/plans/'+archivalPlan.id+'/activate',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{reason:'Attempt to activate archived course in plan'}});
    assert.equal(cannotActivateArchivedCourse.statusCode,409,
      'Plan containing an inactive course must not become ACTIVE');

    const activation=await write('/plans/'+plan.id+'/activate',{reason:'Synthetic internally approved curriculum version'});
    assert.equal(activation.state,'ACTIVE');
    const oldApprovedCourse=await pool.query('SELECT level,theory_hours,practical_hours FROM courses WHERE id=$1',[course.id]);
    const conflictingNewPlan=Buffer.from([
      'code,title,level,theory hours,practical hours,tutorial hours,credits',
      'TEST-101,تغيير غير معتمد في مقرر نشط,المستوى الأول,9,0,0,1'
    ].join('\\n'),'utf8');
    const rejectedActiveRewrite=await app.inject({method:'POST',
      url:'/api/v1/automatic-planning/plan/commit?departmentId='+department.id+'&programId='+program.id+
        '&planCode=UNSAFE-'+uniq+'&versionLabel=Unsafe%20active%20course%20rewrite',
      headers:{cookie:session,'x-csrf-token':csrf,'content-type':'text/csv'},payload:conflictingNewPlan});
    assert.equal(rejectedActiveRewrite.statusCode,409,
      'Smart plan import must not rewrite contact hours of a course in an active plan');
    const unchangedApprovedCourse=await pool.query('SELECT level,theory_hours,practical_hours FROM courses WHERE id=$1',[course.id]);
    assert.deepEqual(unchangedApprovedCourse.rows,oldApprovedCourse.rows,
      'Rejected conflicting plan must leave approved catalog unchanged');
    const archiveActivePlanCourse=await app.inject({method:'PATCH',
      url:'/api/v1/courses/'+course.id+'/lifecycle',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{active:false,reason:'Attempted archival of active plan course'}});
    assert.equal(archiveActivePlanCourse.statusCode,409,
      'Archiving a course from a currently active curriculum version must be rejected');

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
    // Phase 10: complete nine-column course template; uploaded modes are proposals, not permissions.
    const courseBatch='code,title,level,department,theoryHours,practicalHours,demand,proposedMode,eligibleModes\n'+
      'BULK-'+uniq+',مقرر استيراد اصطناعي,2,قسم اصطناعي,2,1,27,REMOTE,ONSITE|REMOTE\n';
    const coursePreview=await csvUpload('courses','preview',courseBatch);
    assert.equal(coursePreview.statusCode,200,coursePreview.body);
    assert.equal(coursePreview.json().ready,true);
    assert.equal(coursePreview.json().rows[0].demand,27);
    const wrongDepartmentCsv=courseBatch.replace(',قسم اصطناعي,',',قسم غير تابع,');
    const wrongDepartment=await csvUpload('courses','preview',wrongDepartmentCsv);
    assert.equal(wrongDepartment.statusCode,200,wrongDepartment.body);
    assert.equal(wrongDepartment.json().ready,false);
    assert.equal(wrongDepartment.json().importId,null);
    const courseCommit=await csvUpload('courses','commit',courseBatch,
      '&importId='+coursePreview.json().importId);
    assert.equal(courseCommit.statusCode,200,courseCommit.body);
    assert.equal(courseCommit.json().imported,1);
    const importedCourse=await pool.query(
      'SELECT id,mode,eligible_modes,demand FROM courses WHERE department_id=$1 AND code=$2',
      [department.id,'BULK-'+uniq]);
    assert.equal(importedCourse.rows[0].mode,'ONSITE');
    assert.deepEqual(importedCourse.rows[0].eligible_modes,['ONSITE']);
    assert.equal(importedCourse.rows[0].demand,27);
    const suggestions=await app.inject({url:'/api/v1/import/batch/courses/proposals?departmentId='+department.id,
      headers:{cookie:session}});
    assert.equal(suggestions.statusCode,200,suggestions.body);
    assert.ok(suggestions.json().some((p:{course_id:string;requested_mode:string;requires_approval:boolean})=>
      p.course_id===importedCourse.rows[0].id&&p.requested_mode==='REMOTE'&&p.requires_approval));
    const legacy=await app.inject({method:'POST',url:'/api/v1/import/courses/commit',
      headers:{cookie:session,'x-csrf-token':csrf},payload:{departmentId:department.id,csv:'some,data'}});
    assert.equal(legacy.statusCode,410,'Legacy course imports cannot bypass preview approval');
    const approveImportedModes=await app.inject({method:'PUT',
      url:'/api/v1/courses/'+importedCourse.rows[0].id+'/eligibility',
      headers:{cookie:session,'x-csrf-token':csrf},
      payload:{eligibleModes:['ONSITE','REMOTE'],reason:'Synthetic approval outside import workflow'}});
    assert.equal(approveImportedModes.statusCode,200,approveImportedModes.body);
    const invalidResource=await csvUpload('rooms','preview',
      'code,name,type,capacity,building,available\nR-IMP,Bad room,LAB,0,B1,\n');
    assert.equal(invalidResource.statusCode,200,invalidResource.body);
    assert.equal(invalidResource.json().ready,false);
    assert.equal(invalidResource.json().importId,null);
    assert.equal(invalidResource.json().errors[0].row,2);
    const safeCsv='code,name,type,capacity,building,available\nR-IMP-'+uniq+',قاعة دفعة,CLASSROOM,36,B1,\n';
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
    const {execFileSync}=await import('node:child_process');
    const python=process.env.TPS_PYTHON??(process.platform==='win32'?'python':'python3');
    const generated=execFileSync(python,['-c',
      "import sys,io;from openpyxl import Workbook;w=Workbook();s=w.active;s.title='البيانات';"+
      "s.append(['code','title','level','department','theoryHours','practicalHours','demand','proposedMode','eligibleModes']);"+
      "s.append(['XL-"+uniq+"','مقرر Excel اصطناعي',2,'قسم اصطناعي',3,0,0,'ONSITE','ONSITE']);"+
      "b=io.BytesIO();w.save(b);sys.stdout.buffer.write(b.getvalue())"
    ],{maxBuffer:1024*1024});
    const bulkExcelHeaders={cookie:session,'x-csrf-token':csrf,
      'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
    const excelPreview=await app.inject({method:'POST',
      url:'/api/v1/import/batch/courses/preview?'+scope,
      headers:bulkExcelHeaders,payload:generated});
    assert.equal(excelPreview.statusCode,200,excelPreview.body);
    assert.equal(excelPreview.json().ready,true);
    const excelCommit=await app.inject({method:'POST',
      url:'/api/v1/import/batch/courses/commit?'+scope+'&importId='+excelPreview.json().importId,
      headers:bulkExcelHeaders,payload:generated});
    assert.equal(excelCommit.statusCode,200,excelCommit.body);
    assert.equal(excelCommit.json().imported,1,'Actual XLSX course data must be committed');
    const persistedExcel=await pool.query('SELECT title FROM courses WHERE department_id=$1 AND code=$2',
      [department.id,'XL-'+uniq]);
    assert.equal(persistedExcel.rows[0].title,'مقرر Excel اصطناعي');
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
    const printable=await app.inject({url:'/api/v1/scenarios/'+created.id+'/print',
      headers:{cookie:session}});
    assert.equal(printable.statusCode,200,printable.body);
    assert.match(String(printable.headers['content-type']),/text\/html/);
    assert.match(printable.body,/طباعة أو حفظ PDF/);
    assert.match(printable.body,/حالة السيناريو/);
    assert.ok(!printable.body.includes('access_token'),'No API secrets in report');
    const xlsxTemplate=await app.inject({
      url:'/api/v1/import/batch/instructors/template.xlsx',headers:{cookie:session}});
    assert.equal(xlsxTemplate.statusCode,200,xlsxTemplate.body);
    assert.equal(xlsxTemplate.rawPayload.subarray(0,2).toString('ascii'),'PK');
    const trainerCsv='code,name,department,maxLoad,eligibleCourseCodes,allowedModes,available\nI-IMP-'+uniq+
      ',مدرب اصطناعي للدفعة,قسم اصطناعي,18,TEST-101,ONSITE,\n';
    const trainerPreview=await csvUpload('instructors','preview',trainerCsv);
    assert.equal(trainerPreview.statusCode,200,trainerPreview.body);
    const trainerCommit=await csvUpload('instructors','commit',trainerCsv,
      '&importId='+trainerPreview.json().importId);
    assert.equal(trainerCommit.statusCode,200,trainerCommit.body);
    const trainerImport=await pool.query('SELECT overload,max_load FROM instructors WHERE department_id=$1 AND code=$2',
      [department.id,'I-IMP-'+uniq]);
    assert.equal(trainerImport.rowCount,1);
    assert.equal(trainerImport.rows[0].overload,null,'Bulk import cannot approve overload');
    const blockCsv='cohortCode,level,code,name,size,courseCodes\nGROUP-'+uniq+
      ',1,B-IMP,بلوك تجريبي,10,TEST-101\n';
    const wrongBlockLevel=await csvUpload('blocks','preview',
      blockCsv.replace(',1,B-IMP,',',2,B-IMP,'));
    assert.equal(wrongBlockLevel.statusCode,200,wrongBlockLevel.body);
    assert.equal(wrongBlockLevel.json().ready,false,'Block level must agree with registered cohort');
    assert.equal(wrongBlockLevel.json().importId,null);
    const blockPreview=await csvUpload('blocks','preview',blockCsv);
    assert.equal(blockPreview.statusCode,200,blockPreview.body);
    const blockCommit=await csvUpload('blocks','commit',blockCsv,
      '&importId='+blockPreview.json().importId);
    assert.equal(blockCommit.statusCode,200,blockCommit.body);
    const blockPersisted=await pool.query(`SELECT b.size FROM student_blocks b JOIN cohorts co ON co.id=b.cohort_id
      WHERE co.department_id=$1 AND co.code=$2 AND b.code='B-IMP'`,[department.id,'GROUP-'+uniq]);
    assert.equal(blockPersisted.rows[0].size,10);
    const demandCsv='courseCode,level,baseStudents,repeatRate,source,confidence\nADV-102,2,0,0.05,Academic forecast,HIGH\n';
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
    assert.equal(committedJobs.rows[0].n,6,'Five bulk entity kinds plus actual XLSX import each committed once');

    const next=await write('/scenarios/'+created.id+'/revise',{});
    assert.equal(next.revision,2);
    const compare=await app.inject({url:'/api/v1/scenarios/compare?ids='+created.id+','+next.id,headers:{cookie:session}});
    assert.equal(compare.statusCode,200,compare.body);
    assert.equal(compare.json().first.sections,1);
    assert.equal(compare.json().second.sections,1);
  }finally{await app.close();await pool.end();}
});
