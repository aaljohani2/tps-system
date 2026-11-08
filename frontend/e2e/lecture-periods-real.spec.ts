import {test,expect} from '@playwright/test';

test('real fixed lecture periods render exact minutes and visible nonblocking Economics overlaps',async({page})=>{
 test.setTimeout(40000);
 const username=process.env.TPS_TEST_USERNAME,password=process.env.TPS_TEST_PASSWORD;
 test.skip(!username||!password,'Requires an isolated synthetic local database');
 await page.goto('/');await page.getByLabel('اسم المستخدم').fill(username!);await page.getByLabel('كلمة المرور').fill(password!);
 await page.getByRole('button',{name:'دخول النظام'}).click();
 await expect(page.getByRole('heading',{name:'إدارة الجداول التدريبية'})).toBeVisible();
 const request=page.context().request,me=await (await request.get('/api/v1/auth/me')).json(),headers={'x-csrf-token':me.csrfToken};
 const post=async(path:string,data:Record<string,unknown>)=>{const response=await request.post('/api/v1'+path,{headers,data});expect(response.status(),await response.text()).toBe(200);return response.json();};
 const key=Date.now().toString(),institution=await post('/institutions',{name:'Synthetic period browser '+key});
 const college=await post('/colleges',{institutionId:institution.id,name:'Synthetic period college '+key});
 const department=await post('/departments',{collegeId:college.id,name:'Synthetic period department'});
 const term=await post('/terms',{collegeId:college.id,code:key,label:'Synthetic period term',startsOn:'2027-01-01',endsOn:'2027-06-01'});
 await post('/instructors',{departmentId:department.id,code:'2',name:'Synthetic Economics',maxLoad:12,eligibleCourseCodes:['اقصد-101'],available:[{day:'SUN',from:10,to:12.5}]});
 await post('/instructors',{departmentId:department.id,code:'OTHER',name:'Synthetic other',maxLoad:24,eligibleCourseCodes:['MAIN'],teachingRules:{preferredCreditedLoad:2,allowedCourseTypes:['THEORY','MIXED']},available:[{day:'SUN',from:10,to:12}]});
 await post('/courses',{departmentId:department.id,code:'اقصد-101',title:'مقدمة الاقتصاد الاصطناعية',level:1,demand:20,theoryHours:3,practicalHours:0,blocks:['G::A'],assignedInstructorId:'2'});
 await post('/courses',{departmentId:department.id,code:'MAIN',title:'مقرر الفترات الاصطناعي',level:1,demand:20,theoryHours:2,practicalHours:0,blocks:['G::A']});
 for(const code of ['A','B'])await post('/rooms',{collegeId:college.id,code,name:'Synthetic room '+code,type:'CLASSROOM',capacity:30});
 const scope={departmentId:department.id,termId:term.id};
 const current=await (await request.get('/api/v1/policies?'+new URLSearchParams(scope))).json(),policy=current.effectivePolicy;
 policy.slots=[{day:'SUN',from:7,to:14.5}];
 policy.priorityCourseCodes=['MAIN'];
 policy.lecturePeriods={academicHourMinutes:50,partialPeriod:'TRIM_END',
  regular:[{startMinute:480,endMinute:580,trainingHours:2},{startMinute:600,endMinute:700,trainingHours:2},{startMinute:720,endMinute:820,trainingHours:2}],
  courseOverrides:{'اقصد-101':{allowCohortOverlap:true,periods:[{startMinute:420,endMinute:570,trainingHours:3},{startMinute:600,endMinute:750,trainingHours:3},{startMinute:720,endMinute:870,trainingHours:3}]}}};
 const saved=await request.put('/api/v1/policies',{headers,data:{...scope,policy,rationale:'Synthetic fixed period UI regression'}});expect(saved.status()).toBe(200);
 await post('/policies/approve',scope);
 const scenario=await post('/scenarios',{...scope,name:'Synthetic precise periods'});await post('/scenarios/'+scenario.id+'/solve',{seconds:1,candidatesPerInstructor:3});
 await page.evaluate(context=>localStorage.setItem('tps-context',JSON.stringify(context)),{collegeId:college.id,...scope});
 await page.goto('/scheduling?scenario='+scenario.id);
 const periods=page.getByRole('region',{name:'فترات المحاضرات المحفوظة'});
 await expect(periods).toContainText('08:00–09:40');await expect(periods).toContainText('12:00–14:30');
 const coverage=page.getByRole('region',{name:'تغطية مقررات القسم ذات الأولوية'});
 await expect(coverage).toContainText('داخل القسم');await expect(coverage).toContainText('1 / 1');await expect(coverage).toContainText('مغطى بالكامل');
 await expect(page.getByRole('region',{name:'ضوابط إسناد المدربين'})).toContainText('2 / 2');
 const grid=page.getByRole('region',{name:'شبكة الجداول الأسبوعية'});
 const ordinary=grid.getByRole('button',{name:/مقرر الفترات الاصطناعي/}).first();
 await expect(ordinary).toContainText('10:00–11:40');await expect(ordinary).toContainText('تداخل اقتصاد مسموح');
 await ordinary.click();await expect(page.getByRole('region',{name:'تفاصيل المحاضرة المحددة'})).toContainText('ECONOMICS_COHORT_OVERLAP');
 const csv=await request.get('/api/v1/scenarios/'+scenario.id+'/export.csv');expect(await csv.text()).toContain('11:40');
 const readiness=await (await request.get('/api/v1/scenarios/'+scenario.id+'/readiness')).json();expect(readiness.technicalReady).toBe(true);
 const reports=page.getByRole('region',{name:'تقارير السيناريو Excel وPDF'});
 for(const title of ['جداول المدربين','جداول المتدربين','جداول القاعات']){
  await expect(reports.getByRole('link',{name:title+' Excel'})).toBeVisible();
  await expect(reports.getByRole('link',{name:title+' PDF'})).toBeVisible();
 }
 const pdf=await request.get((await reports.getByRole('link',{name:'جداول المدربين PDF'}).getAttribute('href'))!);
 expect(pdf.status()).toBe(200);expect((await pdf.body()).subarray(0,4).toString()).toBe('%PDF');
});
