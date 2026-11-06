import {test,expect} from '@playwright/test';

test('local admin login and navigation',async({page})=>{
  const username=process.env.TPS_TEST_USERNAME,password=process.env.TPS_TEST_PASSWORD;
  test.skip(!username||!password,'Provide dedicated synthetic local test credentials.');
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'نظام تخطيط وجدولة التدريب'})).toBeVisible();
  await page.getByLabel('اسم المستخدم').fill(username!);
  await page.getByLabel('كلمة المرور').fill(password!);
  await page.getByRole('button',{name:'دخول النظام'}).click();
  await expect(page.getByRole('heading',{name:'إدارة الجداول التدريبية'})).toBeVisible();
  await page.getByRole('link',{name:/المقررات والطلب/}).click();
  await expect(page.getByRole('heading',{name:/النطاق غير مكتمل|استيراد وإدارة المقررات/})).toBeVisible();
});
