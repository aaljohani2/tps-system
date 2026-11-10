import {test,expect} from '@playwright/test';

test('real external course roster stays at 40 outside department metrics and downloads its handoff',async({page})=>{
 test.setTimeout(30000);
 const username=process.env.TPS_TEST_USERNAME,password=process.env.TPS_TEST_PASSWORD;
 test.skip(!username||!password,'Requires an isolated synthetic local database');
 await page.goto('/');
 await page.getByLabel('اسم المستخدم').fill(username!);
 await page.getByLabel('كلمة المرور').fill(password!);
 await page.getByRole('button',{name:'دخول النظام'}).click();
 await expect(page.getByRole('heading',{name:'إدارة الجداول التدريبية'})).toBeVisible();
 const request=page.context().request,me=await (await request.get('/api/v1/auth/me')).json();
 const post=async(path:string,data:Record<string,unknown>)=>{
  const response=await request.post('/api/v1'+path,{headers:{'x-csrf-token':me.csrfToken},data});
  expect(response.status(),await response.text()).toBe(200);return response.json();
 };
 const key=Date.now().toString();
 const institution=await post('/institutions',{name:'Synthetic external browser '+key});
 const college=await post('/colleges',{institutionId:institution.id,name:'Synthetic external college '+key});
 const department=await post('/departments',{collegeId:college.id,name:'Synthetic external department'});
 const term=await post('/terms',{collegeId:college.id,code:key,label:'Synthetic external term',startsOn:'2027-01-01',endsOn:'2027-06-01'});
 await post('/courses',{departmentId:department.id,code:'OWN',title:'مقرر القسم الاصطناعي',level:2,demand:20,theoryHours:2,practicalHours:0,blocks:['OWN-A']});
 await post('/courses',{departmentId:department.id,code:'GENERAL',title:'لغة عامة اصطناعية',level:1,demand:157,
  theoryHours:3,practicalHours:0,assignmentScope:'EXTERNAL',externalSectionCapacity:40});
 await post('/instructors',{departmentId:department.id,code:'LOCAL',name:'Synthetic local instructor',maxLoad:18,eligibleCourseCodes:['OWN'],
  teachingRules:{maxContactHours:2,maxSections:1,preferredCourseTypes:['THEORY']}});
 await post('/rooms',{collegeId:college.id,code:'ROOM',name:'Synthetic classroom',type:'CLASSROOM',capacity:30});
 const scenario=await post('/scenarios',{departmentId:department.id,termId:term.id,name:'Synthetic external roster'});
 expect(scenario.result.metrics.sectionCount).toBe(1);
 expect(scenario.result.gaps).toHaveLength(0);
 expect(scenario.result.instructorLoads[0].credited).toBe(2);
 await page.evaluate(context=>localStorage.setItem('tps-context',JSON.stringify(context)),{collegeId:college.id,departmentId:department.id,termId:term.id});
 await page.goto('/scheduling?scenario='+scenario.id);
 const panel=page.getByRole('region',{name:'المقررات العامة بإسناد خارجي'});
 await expect(panel).toContainText('لا تدخل في نصاب مدربي القسم أو عجزه');
 await expect(panel.getByRole('row').filter({hasText:'لغة عامة اصطناعية'})).toContainText('40، 40، 40، 37');
 await expect(page.getByText('شعب القسم',{exact:true})).toBeVisible();
 const rules=page.getByRole('region',{name:'ضوابط إسناد المدربين'});
 await expect(rules).toBeVisible();
 await expect(rules.getByRole('row').filter({hasText:'Synthetic local instructor'})).toContainText('نظري بحت');
 const link=panel.getByRole('link',{name:'تنزيل كشف الإسناد الخارجي CSV'});
 const csv=await request.get((await link.getAttribute('href'))!);
 expect(csv.status()).toBe(200);const body=await csv.text();
 expect(body.trim().split('\r\n')).toHaveLength(5);
 expect(body).toContain('بانتظار إسناد القسم الآخر');
 expect(body).not.toContain('Synthetic local instructor');
 await page.goto('/resources');
 await page.locator('summary').filter({hasText:'LOCAL — Synthetic local instructor'}).click();
 await expect(page.getByLabel('الحد الأقصى لساعات الجدول الفعلية')).toHaveValue('2');
 await expect(page.getByLabel('الحد الأقصى لعدد الشعب')).toHaveValue('1');
});
