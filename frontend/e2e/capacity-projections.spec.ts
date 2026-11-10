import {test,expect} from '@playwright/test';

test('saved next-term scenarios show their own capacities, distribution and economics exception',async({page})=>{
 test.setTimeout(20000);
 test.skip(process.env.TPS_E2E_MOCK!=='1','Synthetic mocked UI verification');
 await page.addInitScript(()=>localStorage.setItem('tps-context',JSON.stringify({collegeId:'college',departmentId:'department',termId:'term'})));
 const specs=[{id:'S1',name:'السيناريو الأول',theory:45,mixed:30,practical:30,economics:50},
  {id:'S2',name:'السيناريو الثاني',theory:100,mixed:50,practical:40,economics:50},
  {id:'S3',name:'السيناريو الثالث',theory:120,mixed:120,practical:40,economics:50}];
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const json=(data:unknown)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  if(path.endsWith('/auth/me'))return json({id:'synthetic',username:'test',role:'SYSTEM_ADMIN',collegeId:null,departmentId:null,csrfToken:'test'});
  if(path==='/api/v1/scenarios')return json(specs.map(spec=>({...spec,state:'DRAFT',solver_status:'COMPLETED'})));
  if(path.endsWith('/readiness'))return json({technicalReady:false,issues:[],byCourse:[]});
  const spec=specs.find(item=>path==='/api/v1/scenarios/'+item.id);
  if(spec){
   const capacity=spec.economics??spec.theory;
   const sections=Array.from({length:Math.ceil(157/capacity)},(_,index)=>({id:'SEC'+index,
    courseCode:'ECO',students:Math.min(capacity,157-index*capacity),capacity,level:1,mode:'ONSITE',state:'UNASSIGNED',blockId:'B'+index,instructorId:null}));
   return json({id:spec.id,name:spec.name,state:'DRAFT',solver_status:'COMPLETED',revision:1,
    input_snapshot:{policy:{ignoreRoomCapacity:true},rooms:[{type:'CLASSROOM'},{type:null}],
     courses:[{code:'ECO',title:'مقدمة في الاقتصاد',level:1,demand:157,theoryHours:3,practicalHours:0,sectionCapacity:capacity},
      {code:'GENERAL',title:'مقدمة تطبيقات الحاسب',level:1,demand:157,theoryHours:1,practicalHours:2,assignmentScope:'EXTERNAL',externalSectionCapacity:40}],
     projection:{label:'تقدير الفصل القادم',newIntake:157,levelStudents:{1:157,2:187,3:110,4:93,5:38},
      cooperativeStudents:38,cooperativeAdministrativeBlocks:2,assumptions:['انتقال مشروط بالاجتياز'],rules:spec}},
    result_snapshot:{status:'DRAFT',sections,sessions:[],gaps:[],instructorLoads:[],notices:['لا توجد قاعات محفوظة'],
     externalSections:[40,40,40,37].map((students,index)=>({id:'EXT'+index,courseCode:'GENERAL',title:'مقدمة تطبيقات الحاسب',level:1,
      students,capacity:40,contactHours:3,responsibleDepartment:null,blockIds:[],status:'PENDING_EXTERNAL_ASSIGNMENT'})),
     metrics:{sectionCount:sections.length,requiredContactHours:sections.length*3,assignedContactHours:0,uncoveredSectionCount:sections.length,uncoveredContactHours:sections.length*3}}});
  }
  return json([]);
 });
 await page.goto('/scheduling?scenario=S3');
 const summary=page.getByRole('region',{name:'افتراضات وتوزيع السيناريو'});
 await expect(summary.getByRole('heading',{name:'افتراضات وتوزيع السيناريو'})).toBeVisible();
 await expect(summary.getByRole('row').filter({hasText:'مقدمة في الاقتصاد'})).toContainText('50، 50، 50، 7');
 await expect(summary).toContainText('المشروع الإنتاجي موقوف');
 await expect(summary).toContainText('سعة القاعات غير مقيّدة');
 const external=page.getByRole('region',{name:'المقررات العامة بإسناد خارجي'});
 await expect(external).toContainText('لا تدخل في نصاب مدربي القسم أو عجزه');
 await expect(external.getByRole('row').filter({hasText:'مقدمة تطبيقات الحاسب'})).toContainText('40، 40، 40، 37');
 await expect(external.getByRole('link',{name:'تنزيل كشف الإسناد الخارجي CSV'})).toHaveAttribute('href','/api/v1/scenarios/S3/external.csv');
 await expect(summary.getByRole('row').filter({hasText:'مقدمة تطبيقات الحاسب'})).toHaveCount(0);
 await page.getByRole('combobox',{name:'السيناريو الحالي',exact:true}).selectOption('S2');
 await expect(summary.getByRole('row').filter({hasText:'مقدمة في الاقتصاد'})).toContainText('50، 50، 50، 7');
 await expect(summary).toContainText('المقرر النظري ذو الشق العملي: 50');
 await page.getByRole('combobox',{name:'السيناريو الحالي',exact:true}).selectOption('S1');
 await expect(summary).toContainText('سعة النظري البحت: 45');
 await expect(summary.getByRole('row').filter({hasText:'مقدمة في الاقتصاد'})).toContainText('50، 50، 50، 7');
 await expect(external.getByRole('row').filter({hasText:'مقدمة تطبيقات الحاسب'})).toContainText('40، 40، 40، 37');
 await expect(external.getByRole('link',{name:'تنزيل كشف الإسناد الخارجي CSV'})).toHaveAttribute('href','/api/v1/scenarios/S1/external.csv');
});
