import {test,expect} from '@playwright/test';

test('automatic planning journey asks for source files and renders calculated groups',async({page})=>{
  test.skip(process.env.TPS_E2E_MOCK!=='1','Mock browser journey is explicitly enabled only for local UI verification');
  await page.addInitScript(()=>localStorage.setItem('tps-context',JSON.stringify({collegeId:'college',departmentId:'department',termId:'term'})));
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const json=(value:unknown)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
    if(path==='/api/v1/auth/me')return json({id:'admin',username:'synthetic',role:'SYSTEM_ADMIN',collegeId:null,departmentId:null,csrfToken:'token'});
    if(path==='/api/v1/programs')return json([{id:'program',code:'BUS',name:'تقنية الأعمال'}]);
    if(path.endsWith('/plan/preview'))return json({sheet:'CSV',curriculum:{metadata:{department:'تقنية الأعمال'},sourceRows:26,warnings:[],
      levels:[1,2,3,4,5].map((level,index)=>({level,courses:Array.from({length:index===4?2:6},(_,i)=>({code:`C${level}-${i}`,normalizedCode:`C${level}-${i}`,title:`مقرر ${level}-${i}`,level,theoryHours:index===4?0:3,practicalHours:0,tutorialHours:0,responsibleDepartment:'تقنية الأعمال',alternativeGroup:index===4?'PATH-5':null,specialKind:index===4?'COOPERATIVE_TRAINING':'REGULAR'}))})),
      courses:[...Array.from({length:24},(_,i)=>({code:`C${Math.floor(i/6)+1}-${i%6}`,normalizedCode:`C${Math.floor(i/6)+1}-${i%6}`,title:`مقرر ${i}`,level:Math.floor(i/6)+1,theoryHours:3,practicalHours:0,tutorialHours:0,responsibleDepartment:'تقنية الأعمال',alternativeGroup:null,specialKind:'REGULAR'})),
        {code:'COOP-5',normalizedCode:'COOP-5',title:'التدريب التعاوني',level:5,theoryHours:0,practicalHours:0,tutorialHours:0,responsibleDepartment:'تقنية الأعمال',alternativeGroup:'PATH-5',specialKind:'COOPERATIVE_TRAINING'},
        {code:'PROJ-5',normalizedCode:'PROJ-5',title:'المشروع الإنتاجي',level:5,theoryHours:0,practicalHours:0,tutorialHours:0,responsibleDepartment:'تقنية الأعمال',alternativeGroup:'PATH-5',specialKind:'PRODUCTION_PROJECT'}]}});
    if(path.endsWith('/plan/commit'))return json({planId:'plan-version',records:26,previousPlanId:null});
    if(path.endsWith('/history/preview'))return json({sheet:'CSV',counts:{1:187,2:110,3:93,4:38,5:76},warnings:[],settings:[],courseCount:25,
      detection:{kind:'COURSE_REGISTRATIONS',strategy:'ALL_TRAINEE_ROWS',uniqueTrainees:504,matchedTrainees:504,matchedRows:4483,ignoredRows:0,
        unmatchedCourseRows:0,traineesAcrossMultipleLevels:178}});
    if(path.endsWith('/calculate'))return json({missingInputs:[],totals:{academicGroups:2,trainingComponents:2,contactHours:6},courses:[{
      code:'C1-0',title:'مبادئ إدارة الأعمال',level:1,demand:165,demandSource:'مصنف سابق — المقررات',confidence:'MEDIUM',historical:true,
      mode:'REMOTE_THEORY',capacity:100,academicGroups:2,groupSizes:[100,65],components:{theory:2,practical:0},contactHours:6,
      complete:true,resourceOwner:'تقنية الأعمال',discrepancy:null,note:null}]});
    if(path.endsWith('/materialize'))return json({programId:'program',demandRecords:25,cohorts:5,blocks:14,assignments:72,
      blockCapacityByLevel:{1:40,2:40,3:40,4:40,5:40},scenarioId:'scenario-auto',
      scenario:{state:'DRAFT',solverStatus:'NOT_RUN',metrics:{sectionCount:72,uncoveredSectionCount:3},gaps:3},scenarioError:null,
      notice:'safe blocks'});
    if(path.endsWith('/solve/async'))return json({id:'scenario-auto',solverStatus:'RUNNING'});
    return json([]);
  });
  await page.goto('/automatic-planning');
  await expect(page.getByRole('heading',{name:'التخطيط الآلي من الملفات الأساسية'})).toBeVisible();
  const inputs=page.locator('input[type=file]');
  await inputs.nth(1).setInputFiles({name:'plan.csv',mimeType:'text/csv',buffer:Buffer.from('synthetic')});
  await page.getByRole('button',{name:'اكتشاف الخطة تلقائيًا'}).click();
  await expect(page.getByText('تم اكتشاف 5 مستويات تدريبية و26 سجلًا للمقررات من CSV.')).toBeVisible();
  await page.getByLabel(/قرار المسار/).selectOption('COOP-5');
  await page.getByLabel('البرنامج').selectOption('program');
  await page.getByPlaceholder('PLAN-1447-V2').fill('PLAN-AUTO-TEST');
  await page.getByPlaceholder('خطة 1447 — الإصدار 2').fill('خطة تلقائية اختبارية');
  await page.getByRole('button',{name:'حفظ إصدار مسودة جديد'}).click();
  await expect(page.getByText(/تم حفظ إصدار الخطة/)).toBeVisible();
  await inputs.nth(2).setInputFiles({name:'history.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('PK synthetic')});
  await page.getByRole('button',{name:'استخراج الأعداد والإعدادات'}).click();
  await expect(page.getByText(/المقررات المكتشفة: 25/)).toBeVisible();
  await expect(page.getByText(/اكتشف النظام 504 متدربًا فريدًا/)).toBeVisible();
  await page.getByRole('button',{name:'احتساب الطلب والشعب تلقائيًا'}).click();
  await expect(page.getByText('مبادئ إدارة الأعمال')).toBeVisible();
  await expect(page.getByText('100، 65')).toBeVisible();
  await page.getByRole('button',{name:'تحديث الطلب والأفواج والبلوكات وتشغيل Timefold'}).click();
  await expect(page.getByText(/الطلب: 25 مقرر · الأفواج: 5 · البلوكات: 14 · التعيينات: 72/)).toBeVisible();
  await expect(page.getByText(/Timefold: بدأ التشغيل/)).toBeVisible();
  await page.goto('/imports');
  await expect(page.getByRole('heading',{name:'الاستيراد الذكي الموحد'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'الاستيراد بالقوالب التشغيلية'})).toBeVisible();
  await expect(page.locator('input[type=file][multiple]')).toHaveCount(1);
});

test('smart /imports refuses to silently select contradictory trainee counts',async({page})=>{
  test.skip(process.env.TPS_E2E_MOCK!=='1','Run only with mock browser fixture');
  await page.addInitScript(()=>localStorage.setItem('tps-context',
    JSON.stringify({collegeId:'college',departmentId:'department',termId:'term'})));
  const json=(value:unknown)=>({status:200,contentType:'application/json',body:JSON.stringify(value)});
  await page.route('**/api/v1/**',async route=>{
    const endpoint=new URL(route.request().url()).pathname;
    const input=route.request().postData()??'';
    if(endpoint==='/api/v1/auth/me')return route.fulfill(json({
      id:'admin',username:'synthetic',role:'SYSTEM_ADMIN',collegeId:null,departmentId:null,csrfToken:'token'}));
    if(endpoint==='/api/v1/programs')return route.fulfill(json([{id:'program',code:'BUS',name:'تقنية الأعمال'}]));
    if(endpoint.endsWith('/plan/preview')){
      if(input!=='PLAN')return route.fulfill({status:400,contentType:'application/json',body:'{"error":"Not a curriculum"}'});
      const c={code:'C1',normalizedCode:'C1',title:'مقرر واحد',level:1,
        theoryHours:2,practicalHours:0,tutorialHours:0,alternativeGroup:null,
        responsibleDepartment:'تقنية الأعمال',specialKind:'REGULAR'};
      return route.fulfill(json({sheet:'CSV',curriculum:{metadata:{department:'تقنية الأعمال'},
        sourceRows:1,warnings:[],levels:[{level:1,courses:[c]}],courses:[c]}}));
    }
    if(endpoint.endsWith('/history/preview')){
      if(input==='PLAN')return route.fulfill({status:400,contentType:'application/json',body:'{"error":"No learner counts"}'});
      const count=input==='COUNT_A'?100:200;
      return route.fulfill(json({sheet:'CSV',counts:{1:count},warnings:[],settings:[],courseCount:1,
        detection:{kind:'COURSE_REGISTRATIONS',strategy:'ALL_TRAINEE_ROWS',
          uniqueTrainees:count,matchedTrainees:count,matchedRows:count}}));
    }
    if(endpoint.endsWith('/resources/preview'))return route.fulfill({
      status:400,contentType:'application/json',body:'{"error":"Not an instructor directory"}'});
    return route.fulfill(json([]));
  });
  await page.goto('/imports');
  await page.locator('input[type=file][multiple]').setInputFiles([
    {name:'plan.csv',mimeType:'text/csv',buffer:Buffer.from('PLAN')},
    {name:'first.csv',mimeType:'text/csv',buffer:Buffer.from('COUNT_A')},
    {name:'second.csv',mimeType:'text/csv',buffer:Buffer.from('COUNT_B')}
  ]);
  await expect(page.getByRole('heading',{name:/مصادر أعداد متعارضة/})).toBeVisible();
  await expect(page.getByRole('button',{name:/اعتماد الملفات وتحديث كامل النظام/})).toHaveCount(0);
  await page.getByRole('button',{name:'استخدام أعداد هذا الملف فقط'}).first().click();
  await expect(page.getByRole('heading',{name:'الأعداد المستخرجة'})).toBeVisible();
  await expect(page.getByRole('cell',{name:'100',exact:true})).toBeVisible();
});

test('one smart multi-file upload at /imports connects plan, counts, instructors, scenario and Timefold',async({page})=>{
  test.skip(process.env.TPS_E2E_MOCK!=='1','Run only with mock browser fixture');
  await page.addInitScript(()=>localStorage.setItem('tps-context',
    JSON.stringify({collegeId:'college',departmentId:'department',termId:'term'})));
  const called:string[]=[];
  const json=(value:unknown)=>({status:200,contentType:'application/json',body:JSON.stringify(value)});
  await page.route('**/api/v1/**',async route=>{
    const endpoint=new URL(route.request().url()).pathname;
    const uploaded=route.request().postData()??'';
    if(endpoint==='/api/v1/auth/me')return route.fulfill(json({
      id:'admin',username:'synthetic',role:'SYSTEM_ADMIN',collegeId:null,departmentId:null,csrfToken:'token'}));
    if(endpoint==='/api/v1/programs')return route.fulfill(json([{id:'program',name:'تقنية الأعمال',code:'BUS'}]));
    if(endpoint.endsWith('/plan/preview')){
      if(uploaded!=='PLAN')return route.fulfill({status:400,contentType:'application/json',body:'{"error":"Not a plan"}'});
      const c={code:'BUS-101',normalizedCode:'BUS-101',title:'مقرر نظري',level:1,
        theoryHours:2,practicalHours:0,tutorialHours:0,alternativeGroup:null,
        responsibleDepartment:'تقنية الأعمال',specialKind:'REGULAR'};
      return route.fulfill(json({sheet:'CSV',curriculum:{metadata:{department:'تقنية الأعمال',program:'تقنية الأعمال'},
        sourceRows:1,warnings:[],levels:[{level:1,courses:[c]}],courses:[c]}}));
    }
    if(endpoint.endsWith('/history/preview')){
      if(uploaded!=='COUNT')return route.fulfill({status:400,contentType:'application/json',body:'{"error":"Not student data"}'});
      return route.fulfill(json({sheet:'CSV',counts:{1:37},warnings:[],settings:[],courseCount:1,
        detection:{kind:'COURSE_REGISTRATIONS',strategy:'ALL_TRAINEE_ROWS',
          uniqueTrainees:37,matchedTrainees:37,matchedRows:90}}));
    }
    if(endpoint.endsWith('/resources/preview')){
      if(uploaded!=='TRAINER')return route.fulfill({status:400,contentType:'application/json',body:'{"error":"Not trainer data"}'});
      return route.fulfill(json({sheet:'CSV',metadata:{department:'تقنية الأعمال'},instructors:1,
        courseLinkedInstructors:1,sourceRows:3,warnings:[],ready:true,sha256:'a'.repeat(64)}));
    }
    if(endpoint.endsWith('/calculate')){called.push('calculate');return route.fulfill(json({
      missingInputs:[],totals:{academicGroups:1,trainingComponents:1,contactHours:2},
      courses:[{code:'BUS-101',title:'مقرر نظري',level:1,demand:37,
        demandSource:'ملف تسجيلات',confidence:'HIGH',historical:false,mode:'ONSITE_THEORY',
        capacity:50,academicGroups:1,groupSizes:[37],components:{theory:1,practical:0},
        contactHours:2,complete:true,resourceOwner:'تقنية الأعمال',discrepancy:null,note:null}] }));}
    if(endpoint.endsWith('/plan/commit')){called.push('plan');return route.fulfill(json({
      planId:'new-plan',records:1,previousPlanId:null}));}
    if(endpoint.endsWith('/resources/commit')){called.push('resources');return route.fulfill(json({
      status:'COMMITTED',imported:1,skipped:0,warnings:[]}));}
    if(endpoint.endsWith('/materialize')){called.push('materialize');return route.fulfill(json({
      programId:'program',demandRecords:1,cohorts:1,blocks:1,assignments:1,
      blockCapacityByLevel:{1:40},scenarioId:'scenario',
      scenario:{state:'DRAFT',solverStatus:'NOT_RUN',metrics:{sectionCount:1,uncoveredSectionCount:0},gaps:0},
      scenarioError:null,notice:'safe blocks'}));}
    if(endpoint.endsWith('/solve/async')){called.push('timefold');return route.fulfill(json({solverStatus:'RUNNING'}));}
    return route.fulfill(json([]));
  });
  await page.goto('/imports');
  await page.locator('input[type=file][multiple]').setInputFiles([
    {name:'curriculum.csv',mimeType:'text/csv',buffer:Buffer.from('PLAN')},
    {name:'students.csv',mimeType:'text/csv',buffer:Buffer.from('COUNT')},
    {name:'instructors.csv',mimeType:'text/csv',buffer:Buffer.from('TRAINER')}
  ]);
  await expect(page.getByText(/تم اكتشاف 1 مستويات تدريبية و1 سجلًا للمقررات/)).toBeVisible();
  await expect(page.getByText(/اكتشف النظام 37 متدربًا فريدًا/)).toBeVisible();
  await expect(page.getByText(/اكتُشف 1 مدربًا/)).toBeVisible();
  await page.getByRole('button',{name:'اعتماد الملفات وتحديث كامل النظام وتشغيل Timefold'}).click();
  await expect(page.getByText(/Timefold: بدأ التشغيل/)).toBeVisible();
  expect(called).toEqual(['calculate','plan','resources','materialize','timefold']);
});
