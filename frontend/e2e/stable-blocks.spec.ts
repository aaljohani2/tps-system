import {test,expect} from '@playwright/test';
test('stable block campus days exclude remote general meetings and source shortages remain visible',async({page})=>{
 test.skip(process.env.TPS_E2E_MOCK!=='1','Explicit local mocked UI test');
 await page.addInitScript(()=>localStorage.setItem('tps-context',JSON.stringify({collegeId:'C',departmentId:'D',termId:'T'})));
 const blocks=[{ref:'STABLE-L1::B01',level:1,size:40},{ref:'STABLE-L1::B02',level:1,size:37}];
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname,json=(data:unknown)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  if(path.endsWith('/auth/me'))return json({id:'synthetic',username:'test',role:'SYSTEM_ADMIN',csrfToken:'test'});
  if(path==='/api/v1/scenarios')return json([{id:'STABLE',name:'Synthetic stable draft',state:'DRAFT',solver_status:'COMPLETED'}]);
  if(path.endsWith('/readiness'))return json({technicalReady:false,issues:[],byCourse:[]});
  if(path==='/api/v1/scenarios/STABLE')return json({id:'STABLE',name:'Synthetic stable draft',state:'DRAFT',solver_status:'COMPLETED',revision:1,
   input_snapshot:{courses:[],policy:{},rooms:[],cohortBlocks:blocks,stableBlockPlan:{remoteSectionCapacity:100,
    sourceRows:[{id:'الإدارة!B4',courseCode:'EN',rawTitle:'الإنجليزية',level:1,physicalColored:false,plannedMode:'REMOTE',kind:'DAY',day:'THU',startMinute:480,endMinute:580,sourceCells:['B4']},
     {id:'الإدارة!C6',courseCode:'AR',rawTitle:'الكتابة الفنية',level:1,physicalColored:true,plannedMode:'ONSITE',kind:'DAY',day:'MON',startMinute:600,endMinute:700,sourceCells:['C6']}],
    bindings:[{sourceItemId:'الإدارة!B4',blockIds:blocks.map(b=>b.ref)},{sourceItemId:'الإدارة!C6',blockIds:[blocks[0]!.ref]}]}},
   result_snapshot:{status:'DRAFT',sections:[],sessions:[{id:'MAIN',sectionId:'MAIN',courseCode:'MAIN',day:'SUN',start:8,end:9.5,mode:'ONSITE',blockId:blocks[0]!.ref,instructorId:'4',roomId:'R'}],
    gaps:[],instructorLoads:[],notices:[],externalSections:[{id:'NEED',courseCode:'EN',title:'الإنجليزية',level:1,students:77,capacity:100,contactHours:4,status:'PENDING_EXTERNAL_ASSIGNMENT'}],
    metrics:{sectionCount:0,requiredContactHours:0,assignedContactHours:0,uncoveredSectionCount:0,uncoveredContactHours:0}}});
  return json([]);
 });
 await page.goto('/scheduling?scenario=STABLE');
 const panel=page.getByRole('region',{name:'البلوكات الثابتة والمصدر العام'});await expect(panel).toContainText('مسودة غير مكتملة');
 await expect(panel).toContainText('سقف الشعبة عن بُعد 100');
 const first=panel.getByRole('table',{name:'أيام قدوم البلوكات'}).getByRole('row').filter({hasText:'STABLE-L1::B01'});
 await expect(first).toContainText('2: الأحد، الاثنين');await expect(first).toContainText('الخميس');
 await panel.getByText('سجل المصدر العام الثابت',{exact:true}).click();
 await expect(panel.getByRole('table',{name:'سجل المصدر العام'}).getByRole('row').filter({hasText:'الإدارة!B4'})).toContainText('عن بُعد');
});
