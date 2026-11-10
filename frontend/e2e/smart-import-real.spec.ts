import {test,expect} from '@playwright/test';

test('real smart upload accepts a resources-only CSV and saves a reviewed capacity conflict',async({page})=>{
  const username=process.env.TPS_TEST_USERNAME,password=process.env.TPS_TEST_PASSWORD;
  test.skip(!username||!password,'Requires an isolated synthetic local database');
  await page.goto('/');
  await page.getByLabel('اسم المستخدم').fill(username!);
  await page.getByLabel('كلمة المرور').fill(password!);
  await page.getByRole('button',{name:'دخول النظام'}).click();
  await page.getByRole('combobox',{name:'الكلية',exact:true}).selectOption({label:'كلية تجريبية — بيانات غير حقيقية'});
  await page.getByRole('combobox',{name:'القسم',exact:true}).selectOption({label:'قسم تجريبي للجدولة'});
  await page.getByRole('combobox',{name:'الفصل التدريبي',exact:true}).selectOption({label:'فصل اصطناعي 2027'});
  await page.goto('/imports');
  const code='SMART-ROOM-'+Date.now();
  const csv=['الوحدة التدريبية;رمز القاعة;وصف القاعة;السعة',
    `كلية تجريبية — بيانات غير حقيقية;${code};قاعة اختبار الاستيراد;40`,
    `كلية تجريبية — بيانات غير حقيقية;${code};قاعة اختبار الاستيراد;50`].join('\n');
  await page.locator('input[type=file][multiple]').setInputFiles({name:'any-name.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  const panel=page.getByRole('heading',{name:'موارد الملف: any-name.csv'}).locator('..');
  await expect(panel.getByText(code,{exact:true})).toBeVisible();
  await expect(panel.getByText(/قيم متعارضة في المصدر: 40، 50/)).toBeVisible();
  const save=panel.getByRole('button',{name:'اعتماد وحفظ المدربين والقاعات الجديدة'});
  await expect(save).toBeDisabled();
  await panel.getByPlaceholder('سعة موثقة').fill('40');
  await panel.locator('select').selectOption('CLASSROOM');
  await save.click();
  await expect(panel.getByText(/القاعات الجديدة 1/)).toBeVisible();
  await page.goto('/resources');
  await expect(page.locator('summary').filter({hasText:code})).toContainText('السعة 40');
});
