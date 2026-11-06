import {test,expect,type Page} from '@playwright/test';

const scenarioId='11111111-1111-4111-8111-111111111111';
const collegeId='22222222-2222-4222-8222-222222222222';
const departmentId='33333333-3333-4333-8333-333333333333';
const termId='44444444-4444-4444-8444-444444444444';
const plan={
  status:'DRAFT',scenarioName:'سيناريو اختبار الواجهة',termId,
  sections:[{id:'T-101-1',courseCode:'T-101',level:2,index:1,mode:'ONSITE',students:25,
    capacity:45,blockId:'C1::B1',paired:false,instructorId:'I1',contactHours:2,creditedLoad:2,state:'SCHEDULED'}],
  sessions:[{id:'S1',sectionId:'T-101-1',courseCode:'T-101',component:'THEORY',
    mode:'ONSITE',day:'SUN',start:8,end:10,roomId:'R1',instructorId:'I1',blockId:'C1::B1'}],
  gaps:[],instructorLoads:[{id:'I1',baseLimit:18,approvedException:0,credited:2,contact:2,remaining:16}],
  metrics:{sectionCount:1,requiredContactHours:2,assignedContactHours:2,
    uncoveredContactHours:0,uncoveredSectionCount:0},notices:[]
};
const scenario={
  id:scenarioId,name:'سيناريو اختبار الواجهة',state:'DRAFT',solver_status:'COMPLETED',
  edit_version:0,revision:1,result_snapshot:plan,
  input_snapshot:{
    courses:[{code:'T-101',title:'المحاسبة المالية',level:2,mode:'ONSITE',theoryHours:2,
      practicalHours:0,demand:25,eligibleModes:['ONSITE'],blocks:['C1::B1']}],
    instructors:[{id:'I1',name:'المدرب التجريبي',allowedModes:['ONSITE'],maxLoad:18}],
    rooms:[{id:'R1',name:'قاعة اختبار',type:'CLASSROOM',capacity:45}],
    policy:{enabledModes:['ONSITE'],slots:[{day:'SUN',from:8,to:14}],sessionMaxHours:4}
  }
};
const readiness={
  technicalReady:false,issues:[{code:'ROOM_OCCUPIED',severity:'BLOCKER',
    message:'Room R1 is occupied by overlapping sessions',sectionId:'T-101-1',courseCode:'T-101'}],
  byCourse:[{code:'T-101',demand:25,sections:1,uncovered:0,missingBlocks:0}]
};
async function mocked(page:Page,role='SYSTEM_ADMIN'){
  await page.addInitScript(({collegeId,departmentId,termId})=>{
    localStorage.setItem('tps-context',JSON.stringify({collegeId,departmentId,termId}));
  },{collegeId,departmentId,termId});
  let patchAttempts=0;
  await page.route('**/api/v1/**',async(route)=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const json=(payload:unknown,status=200)=>route.fulfill({
      status,contentType:'application/json; charset=utf-8',body:JSON.stringify(payload)});
    if(path==='/api/v1/auth/me')return json({id:'administrator',username:'synthetic',role,
      collegeId,departmentId:null,csrfToken:'test-csrf'});
    if(path==='/api/v1/scenarios'&&req.method()==='GET')return json([{id:scenarioId,name:scenario.name,
      state:'DRAFT',solver_status:'COMPLETED'}]);
    if(path==='/api/v1/scenarios/'+scenarioId&&req.method()==='GET')return json(scenario);
    if(path.endsWith('/readiness'))return json(readiness);
    if(path.endsWith('/runs')||path.endsWith('/edits'))return json([]);
    if(path.includes('/sessions/')&&req.method()==='PATCH'){
      patchAttempts++;return json({error:'Manual move blocked: ROOM_OCCUPIED'},409);
    }
    if(path.includes('/import/batch/courses/proposals'))return json([]);
    if(path.includes('/import/batch/courses/preview')&&req.method()==='POST')
      return json({kind:'courses',schemaVersion:'tps.bulk.v1',headers:['code','title','level',
        'department','theoryHours','practicalHours','demand','proposedMode','eligibleModes'],
        rows:[{code:'TEST-1',title:'مقرر تجريبي',level:2,department:'قسم اصطناعي',
          theoryHours:2,practicalHours:0,demand:20,proposedMode:'ONSITE',eligibleModes:['ONSITE']}],
        errors:[],totalRows:1,validRows:1,ready:true,
        importId:'55555555-5555-4555-8555-555555555555'});
    if(path.includes('/import/batch/courses/commit')&&req.method()==='POST')
      return json({status:'COMMITTED',imported:1,kind:'courses'});
    if(path==='/api/v1/colleges')return json([{id:collegeId,name:'كلية اصطناعية'}]);
    if(path==='/api/v1/departments')return json([{id:departmentId,name:'قسم اصطناعي'}]);
    if(path==='/api/v1/terms')return json([{id:termId,label:'فصل تجريبي'}]);
    if(path==='/api/v1/policies')return json({});
    return json([]);
  });
  return ()=>patchAttempts;
}
test('weekly grid provides four views, per-session details, linked blockers and staged DnD',async({page})=>{
  const count=await mocked(page);
  await page.goto('/scheduling');
  await expect(page.getByRole('heading',{name:'إدارة الجداول التدريبية'})).toBeVisible();
  await page.getByLabel('السيناريو الحالي').selectOption(scenarioId);
  await expect(page.getByRole('heading',{name:'الجداول الأسبوعية التفاعلية'})).toBeVisible();
  await expect(page.getByRole('table',{name:/الجدول الأسبوعي/})).toBeVisible();
  const views=['جداول المدربين','جداول القاعات','جداول المستويات','جداول البلوكات'];
  for(const v of views){
    await page.getByLabel('نوع العرض').selectOption({label:v});
    await expect(page.getByRole('table',{name:/الجدول الأسبوعي/})).toBeVisible();
  }
  await page.getByLabel('نوع العرض').selectOption({label:views[0]!});
  await expect(page.getByText('القاعة مشغولة')).toBeVisible();
  await page.getByRole('button',{name:'عرض السجل المرتبط في الجدول'}).click();
  await expect(page.getByRole('region',{name:'تفاصيل المحاضرة المحددة'})).toBeVisible();
  await expect(page.getByText(/المحاسبة المالية/).first()).toBeVisible();
  await expect(page.getByRole('button',{name:/تعديل الموعد أو القاعة/})).toBeVisible();
  const movable=page.locator('.week-session').first();
  const cell=page.locator('.week-slot').filter({has:movable}).first();
  await movable.dragTo(cell);
  await expect(page.getByText(/لم يتم حفظ أي تغيير بعد/)).toBeVisible();
  expect(count()).toBe(0);
  await page.getByLabel('سبب النقل').fill('طلب نقل تجريبي اختباري دون حفظ');
  await page.getByRole('button',{name:/حفظ النقل بعد فحص التعارضات/}).click();
  await expect(page.getByRole('status').filter({hasText:/Manual move blocked/})).toBeVisible();
  expect(count()).toBe(1);
});
test('viewer can inspect weekly schedules but cannot drag or open manual edit controls',async({page})=>{
  const count=await mocked(page,'VIEWER');
  await page.goto('/scheduling');
  await page.getByLabel('السيناريو الحالي').selectOption(scenarioId);
  const card=page.locator('.week-session').first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('draggable','false');
  await expect(page.getByRole('button',{name:/حفظ النقل بعد فحص التعارضات/})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'تشغيل Timefold'})).toBeDisabled();
  expect(count()).toBe(0);
});
test('course import UI previews before enabling exact-file confirmation',async({page})=>{
  await mocked(page);
  await page.goto('/imports');
  await page.getByRole('button',{name:'المقررات'}).click();
  await expect(page.getByText(/الأهلية المقترحة لا تُمنح تلقائياً|لا يُفعّل أي نمط اختياري/)).toBeVisible();
  const commit=page.getByRole('button',{name:/اعتماد استيراد/});
  await expect(commit).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({name:'courses.csv',mimeType:'text/csv',
    buffer:Buffer.from('code,title,level,department,theoryHours,practicalHours,demand,proposedMode,eligibleModes\nTEST-1,مقرر تجريبي,2,قسم اصطناعي,2,0,20,ONSITE,ONSITE\n')});
  await page.getByRole('button',{name:'معاينة وفحص جميع الصفوف'}).click();
  await expect(page.getByText('الملف صالح للعرض والموافقة.')).toBeVisible();
  await page.getByRole('button',{name:/اعتماد استيراد 1 صفًا/}).click();
  await expect(page.getByText(/تم الحفظ بنجاح/)).toBeVisible();
});
