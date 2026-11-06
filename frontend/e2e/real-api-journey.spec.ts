import {test,expect} from '@playwright/test';

// Real browser + Fastify + PostgreSQL + Java Timefold; no mocked API routes.
// Requires an isolated synthetic database populated with db:seed.
test('real local TPS journey: auth, academic context, scheduling, Timefold, review, approval and exports',async({page})=>{
  test.setTimeout(120000);
  const username=process.env.TPS_TEST_USERNAME,password=process.env.TPS_TEST_PASSWORD;
  test.skip(!username||!password,'Synthetic CI admin credentials are required');
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'نظام تخطيط وجدولة التدريب'})).toBeVisible();
  await page.getByLabel('اسم المستخدم').fill(username!);
  await page.getByLabel('كلمة المرور').fill(password!);
  await page.getByRole('button',{name:'دخول النظام'}).click();
  await expect(page.getByRole('heading',{name:'إدارة الجداول التدريبية'})).toBeVisible();

  // Real PostgreSQL-backed select options in the isolated seeded institution.
  await page.getByRole('combobox',{name:'الكلية',exact:true})
    .selectOption({label:'كلية تجريبية — بيانات غير حقيقية'});
  await page.getByRole('combobox',{name:'القسم',exact:true})
    .selectOption({label:'قسم تجريبي للجدولة'});
  await page.getByRole('combobox',{name:'الفصل التدريبي',exact:true})
    .selectOption({label:'فصل اصطناعي 2027'});

  // Read-only screens must really load from the API rather than mocked data.
  await page.getByRole('link',{name:/المقررات/,exact:true}).click();
  await expect(page.getByText('TPS-TEST-101').first()).toBeVisible();
  await page.getByRole('link',{name:/المدربون والقاعات/,exact:true}).click();
  await expect(page.getByText('TPS-I1').first()).toBeVisible();
  await page.getByRole('link',{name:/البرامج والأفواج والبلوكات/,exact:true}).click();
  await expect(page.getByText('TPS-G1').first()).toBeVisible();

  await page.getByRole('link',{name:/الشعب والجدولة والاعتماد/,exact:true}).click();
  await expect(page.getByRole('heading',{name:/إنشاء الشعب وتشغيل Timefold/})).toBeVisible();
  await page.getByPlaceholder('اسم السيناريو').fill('اختبار متصفح CI ببيانات اصطناعية');
  await page.getByRole('button',{name:'إنشاء السيناريو والشعب'}).click();
  await expect(page.locator('.status').first()).toContainText('NOT_RUN',{timeout:15000});

  // The UI uses the new non-blocking route; the browser observes real progress.
  await page.getByRole('button',{name:'تشغيل Timefold',exact:true}).click();
  await expect(page.locator('.status').first()).toContainText('COMPLETED',{timeout:45000});
  await expect(page.getByText('Timefold يعالج البدائل').or(page.getByText('مكتمل')).first()).toBeVisible();
  await expect(page.getByText('TPS-TEST-101').first()).toBeVisible();

  await page.getByRole('button',{name:'إرسال للمراجعة'}).click();
  await expect(page.locator('.status').first()).toContainText('UNDER_REVIEW',{timeout:15000});
  await page.getByRole('button',{name:'اعتماد السيناريو'}).click();
  await expect(page.locator('.status').first()).toContainText('APPROVED',{timeout:15000});

  // Read the actual saved file endpoints through the browser context's cookie jar.
  const csvLink=page.getByRole('link',{name:'تصدير CSV'});
  const xlsxLink=page.getByRole('link',{name:'تصدير Excel',exact:true});
  const csv=await page.context().request.get(new URL(await csvLink.getAttribute('href')??'',page.url()).toString());
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const csvText=await csv.text();
  expect(csvText).toContain('APPROVED');
  const excel=await page.context().request.get(new URL(await xlsxLink.getAttribute('href')??'',page.url()).toString());
  expect(excel.status()).toBe(200);
  const header=(await excel.body()).subarray(0,2).toString('ascii');
  expect(header).toBe('PK');
  await page.getByRole('button',{name:'تسجيل الخروج'}).click();
  await expect(page.getByRole('heading',{name:'نظام تخطيط وجدولة التدريب'})).toBeVisible();
});
