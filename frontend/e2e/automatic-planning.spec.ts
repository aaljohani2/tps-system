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
