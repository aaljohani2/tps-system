import {test,expect} from '@playwright/test';

test('fixed general source times retain their modes and block department planning controls',async({page})=>{
 test.skip(process.env.TPS_E2E_MOCK!=='1','Explicit synthetic UI verification');
 const rows=[
  {id:'SYNTHETIC-1',level:1,section:1,title:'مقرر تجريبي صباحي',day:'SUN',period:'صباحية',startMinute:480,endMinute:580,mode:'ONSITE'},
  {id:'SYNTHETIC-2',level:1,section:1,title:'مقرر تجريبي ذاتي',day:'MON',period:'مسائية',startMinute:1080,endMinute:1180,mode:'SELF_PACED'},
  {id:'SYNTHETIC-3',level:2,section:2,title:'مقرر تجريبي غير محدد النمط',day:'TUE',period:'مسائية',startMinute:1200,endMinute:1250,mode:'UNSPECIFIED'}
 ];
 const scenario={id:'SYNTHETIC-STAGE',name:'Synthetic source-only draft',state:'DRAFT',solver_status:'NOT_RUN',revision:1,
  input_snapshot:{courses:[],instructors:[],rooms:[],policy:{},fixedGeneralStage:{version:1,phase:'GENERAL_TIMES_ONLY',rows}},
  result_snapshot:{status:'DRAFT',sections:[],sessions:[],gaps:[],instructorLoads:[],notices:[],
   metrics:{sectionCount:0,requiredContactHours:0,assignedContactHours:0,uncoveredContactHours:0,uncoveredSectionCount:0}}};
 const writes:string[]=[];
 await page.addInitScript(()=>localStorage.setItem('tps-context',JSON.stringify({collegeId:'C',departmentId:'D',termId:'T'})));
 await page.route('**/api/v1/**',async route=>{
  if(route.request().method()!=='GET')writes.push(route.request().url());
  const path=new URL(route.request().url()).pathname;
  const json=(data:unknown)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  if(path.endsWith('/auth/me'))return json({id:'synthetic',username:'synthetic',role:'SYSTEM_ADMIN',csrfToken:'synthetic'});
  if(path==='/api/v1/scenarios')return json([scenario]);
  if(path==='/api/v1/scenarios/'+scenario.id)return json(scenario);
  return json([]);
 });
 await page.goto('/scheduling?scenario='+scenario.id);
 const panel=page.getByRole('region',{name:'المرحلة الأولى: أوقات المواد العامة المثبتة'});
 await expect(panel).toContainText('3 موعدًا');
 const table=panel.getByRole('table');await expect(table.getByRole('row')).toHaveCount(4);
 for(const [index,start,end,mode] of [[0,'08:00','09:40','حضوري'],[1,'18:00','19:40','ذاتي'],[2,'20:00','20:50','غير مذكور']] as const){
  const cells=table.getByRole('row').filter({hasText:rows[index]!.id}).getByRole('cell');
  await expect(cells.nth(5)).toHaveText(start);await expect(cells.nth(6)).toHaveText(end);await expect(cells.nth(7)).toHaveText(mode);
 }
 await expect(page.getByRole('button',{name:'تشغيل Timefold',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'إنشاء السيناريو والشعب',exact:true})).toBeDisabled();
 await expect(page.getByText('كشف العجز',{exact:true})).toHaveCount(0);
 await expect(panel.getByRole('link')).toHaveAttribute('href','/api/v1/scenarios/'+scenario.id+'/external.csv');
 expect(writes).toEqual([]);
});
