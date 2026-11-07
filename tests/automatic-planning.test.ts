import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAutomaticPlan,extractHistoricalCourseSettings,extractHistoricalLevelCounts,extractInstructorDirectory,extractTraineeDemand,importAutomaticCurriculumCsv,
  normalizeCourseCode,resolveLevelDemand,type AutomaticCurriculum} from '../src/automatic-planning.js';

const header='المؤسسة,الكلية,القسم,اسم البرنامج,رمز المقرر,اسم المقرر,الفصل التدريبي,مح,عم,تم,الوحدات المعتمدة,المتطلبات السابقة,المقررات المكافئة,الجهة المسؤولة,مجموعة البدائل';
const regular=[
  ['ادار 101','مبادئ إدارة الأعمال',1,3,0,0,'تقنية الأعمال'],
  ['اقصد-101','مقدمة في الاقتصاد',1,3,0,0,'الدراسات العامة'],
  ['انجل-111','لغة إنجليزية (1)',1,3,0,1,'الدراسات العامة'],
  ['حاسب-101','مقدمة تطبيقات الحاسب',1,0,4,0,'الحاسب الآلي'],
  ['رياض-101','الرياضيات',1,3,0,1,'الدراسات العامة'],
  ['عربي-101','الكتابة الفنية',1,2,0,0,'الدراسات العامة'],
  ['احصا-101','مقدمة في الإحصاء',2,3,0,0,'الدراسات العامة'],
  ['ادار-111','الاتصالات الإدارية',2,2,2,0,'تقنية الأعمال'],
  ['ادار-151','مهارات الطباعة العربية',2,0,4,0,'تقنية الأعمال'],
  ['انجل-112','لغة إنجليزية (2)',2,3,0,1,'الدراسات العامة'],
  ['حاسب-102','تطبيقات الحاسب المتقدمة',2,0,4,0,'الحاسب الآلي'],
  ['رياد-101','أساسيات ريادة الأعمال',2,2,0,0,'تقنية الأعمال'],
  ['ادار-121','إدارة وتقنيات المكاتب',3,2,2,0,'تقنية الأعمال'],
  ['ادار-152','مهارات الطباعة بالانجليزية',3,0,4,0,'تقنية الأعمال'],
  ['ادار-222','إجراءات السكرتارية',3,2,0,1,'تقنية الأعمال'],
  ['ادار-271','إدارة الجودة الشاملة',3,2,0,1,'تقنية الأعمال'],
  ['انجل-113','لغة إنجليزية (3)',3,3,0,1,'الدراسات العامة'],
  ['رياد-262','ريادة الأعمال في الإدارة',3,1,2,0,'تقنية الأعمال'],
  ['ادار-231','إدارة الموارد البشرية',4,3,0,1,'تقنية الأعمال'],
  ['ادار-241','إدارة الوقت',4,2,0,1,'تقنية الأعمال'],
  ['ادار-253','استخدام الحاسب في الأعمال',4,0,4,0,'تقنية الأعمال'],
  ['ادار-285','موضوعات مختارة',4,2,0,1,'تقنية الأعمال'],
  ['اسلك-201','السلوك الوظيفي',4,2,0,0,'الدراسات العامة'],
  ['اسلم-101','الثقافة الإسلامية',4,2,0,0,'الدراسات العامة']
] as const;
const levelNames=['','الفصل التدريبي الأول','المستوى الثاني','الفصل التدريبي الثالث','المستوى الرابع','المستوى الخامس'];
function csv(){
  const rows=regular.map(([code,title,level,theory,practical,tutorial,owner])=>
    ['التدريب التقني','الكلية التقنية','تقنية الأعمال','الإدارة المكتبية',code,title,levelNames[level],theory,practical,tutorial,4,'','',owner,''].join(','));
  rows.push(['التدريب التقني','الكلية التقنية','تقنية الأعمال','الإدارة المكتبية','تعاو-501','التدريب التعاوني',levelNames[5],0,0,0,6,'','','تقنية الأعمال','مسار المستوى الخامس'].join(','));
  rows.push(['التدريب التقني','الكلية التقنية','تقنية الأعمال','الإدارة المكتبية','مشرو-501','المشروع الإنتاجي',levelNames[5],0,0,0,6,'','','تقنية الأعمال','مسار المستوى الخامس'].join(','));
  return '\uFEFF'+header+'\n'+rows.join('\n');
}
const capacities={remoteTheory:100,onsiteTheory:50,practical:40,mixed:40};
const historical={kind:'HISTORICAL_WORKBOOK' as const,counts:{1:165,2:305,3:123,4:96,5:52},
  label:'مصنف التخطيط السابق',confidence:'HIGH' as const,sourceTermId:'144720',targetTermId:'NEXT'};

test('automatic curriculum import discovers five levels, 26 records, metadata and two level-five alternatives',()=>{
  const plan=importAutomaticCurriculumCsv(csv());
  assert.deepEqual(plan.levels.map(x=>[x.level,x.courses.length]),[[1,6],[2,6],[3,6],[4,6],[5,2]]);
  assert.equal(plan.courses.length,26);
  assert.equal(plan.metadata.department,'تقنية الأعمال');
  assert.deepEqual(plan.levels[4]!.courses.map(x=>x.alternativeGroup),['مسار المستوى الخامس','مسار المستوى الخامس']);
  assert.deepEqual(plan.levels[4]!.courses.map(x=>x.specialKind),['COOPERATIVE_TRAINING','PRODUCTION_PROJECT']);
});

test('Arabic code normalization is the primary plan/workbook match key and levels are never inferred from codes',()=>{
  assert.equal(normalizeCourseCode(' إدار ـ ١٠١ '),'ادار-101'.toUpperCase());
  assert.equal(normalizeCourseCode('أو >> ادار-288'),'ادار-288'.toUpperCase());
  const odd=csv().replace('ادار 101,مبادئ','ادار-999,مبادئ');
  assert.equal(importAutomaticCurriculumCsv(odd).courses[0]!.level,1);
});

test('smart instructor discovery filters the selected department and keeps course evidence without inventing availability',()=>{
  const table=[
    ['الفصل التدريبي','الوحدة التدريبية','القسم','رقم المدرب','اسم المدرب','المقرر','وصف المحاضرة'],
    ['1448','الكلية التقنية','تقنية الأعمال','T-01','مدرب تجريبي','ادار-101','نظري صباحي'],
    ['1448','الكلية التقنية','تقنية الأعمال','T-01','مدرب تجريبي','ادار-111','عن بعد'],
    ['1448','الكلية التقنية','الحاسب','T-02','مدرب قسم آخر','برمج-101','عملي']
  ];
  const found=extractInstructorDirectory(table,'تقنية الأعمال');
  assert.equal(found.instructors.length,1);
  assert.deepEqual(found.instructors[0],{code:'T-01',name:'مدرب تجريبي',maxLoad:null,
    eligibleCourseCodes:['ادار-101'.toUpperCase(),'ادار-111'.toUpperCase()],allowedModes:['ONSITE','REMOTE'],sourceRows:2});
  assert.equal(found.metadata.college,'الكلية التقنية');
  assert.match(found.warnings.join(' '),/أقسام أخرى/);
  assert.match(found.warnings.join(' '),/إتاحة مستقبلية/);
});

test('the real curriculum column shape uses course credits, not the repeated program total',()=>{
  const source=[
    'الوحدة التدريبية,الفصل التدريبي,الوحدات المعتمدة,الفصل التدريبي,المقرر,اسم المقرر,المتطلب ,المكافئ,و.م,مح,عم,تم',
    'الكلية التقنية,144720,60,الفصل التدريبي الأول,ادار-101,مبادئ الإدارة,-,ادار-001 ادار-002,3,2,0,1',
  ].join('\n');
  const plan=importAutomaticCurriculumCsv(source);
  assert.equal(plan.courses[0]?.credits,3);
  assert.deepEqual(plan.courses[0]?.equivalents,['ادار-001'.toUpperCase(),'ادار-002'.toUpperCase()]);
});

test('historical workbook counts must be internally consistent within each level',()=>{
  const table=[['المستوى','عدد المتدربين']];
  for(const [level,count] of Object.entries(historical.counts))for(let i=0;i<(Number(level)<5?6:1);i++)
    table.push([levelNames[Number(level)]!,String(count)]);
  const extracted=extractHistoricalLevelCounts(table);
  assert.deepEqual(extracted.counts,historical.counts);assert.deepEqual(extracted.warnings,[]);
  table.push(['المستوى الثاني','304']);
  const conflicting=extractHistoricalLevelCounts(table);
  assert.equal(conflicting.counts[2],undefined);assert.match(conflicting.warnings[0]!,/305, 304|304, 305/);
});

test('historical course sheet discovers 25 operational courses and keeps scenario hours separate',()=>{
  const table=[['رمز المقرر','نظري + تمارين','عم','النمط','المستوى','عدد المتدربين']];
  for(const [index,[code,,level,theory,practical]] of regular.slice(0,25).entries())
    table.push([code,String(index===0?4:theory),String(practical),index===0?'عن بعد':'حضوري',String(level),String(historical.counts[level])]);
  table.push(['تشغل-501','0','0','إشراف','5','52']);
  const result=extractHistoricalCourseSettings(table);
  assert.equal(result.courseCount,25);
  assert.deepEqual(result.settings[0],{code:'ادار 101',mode:'REMOTE_THEORY',theoryHours:4,practicalHours:0});
});

test('demand source priority uses actual counts once per level and labels historical values as estimates',()=>{
  const r=resolveLevelDemand([1,2,3,4,5],[historical,
    {kind:'ACTUAL_LEVEL_COUNTS',counts:{2:311},label:'كشف حديث',confidence:'HIGH',isConfirmedForTarget:true}]);
  assert.equal(r.levels.find(x=>x.level===2)?.students,311);
  assert.equal(r.levels.find(x=>x.level===1)?.students,165);
  assert.equal(r.levels.find(x=>x.level===1)?.historical,true);
  assert.equal(r.levels.find(x=>x.level===1)?.confidence,'MEDIUM');
  assert.deepEqual(r.missing,[]);
});

test('reference calculations create 2 remote groups, 4 onsite groups and 8 paired mixed groups without doubling demand',()=>{
  const plan=importAutomaticCurriculumCsv(csv());
  const demands=resolveLevelDemand([1,2,3,4,5],[historical]).levels;
  const result=calculateAutomaticPlan(plan,demands,capacities,[
    {code:'ادار-101',mode:'REMOTE_THEORY'},
    {code:'اقصد-101',mode:'ONSITE_THEORY'},
    {code:'ادار-111',mode:'MIXED'}
  ],{'مسار المستوى الخامس':'تعاو-501'});
  const business=result.courses.find(c=>c.code==='ادار 101')!;
  assert.equal(business.demand,165);assert.equal(business.academicGroups,2);assert.deepEqual(business.groupSizes,[100,65]);
  const economics=result.courses.find(c=>c.code==='اقصد-101')!;
  assert.equal(economics.academicGroups,4);assert.deepEqual(economics.groupSizes,[50,50,50,15]);
  const admin=result.courses.find(c=>c.code==='ادار-111')!;
  assert.equal(admin.demand,305);assert.equal(admin.academicGroups,8);
  assert.deepEqual(admin.components,{theory:8,practical:8});
  assert.equal(admin.groupSizes.reduce((a,b)=>a+b,0),305);
});

test('cooperative training creates no ordinary meetings and supporting-department ownership remains explicit',()=>{
  const plan=importAutomaticCurriculumCsv(csv());
  const demands=resolveLevelDemand([1,2,3,4,5],[historical]).levels;
  const result=calculateAutomaticPlan(plan,demands,capacities,[],{'مسار المستوى الخامس':'تعاو-501'});
  const coop=result.courses.find(c=>c.code==='تعاو-501')!;
  assert.equal(coop.academicGroups,0);assert.equal(coop.components.theory,0);assert.match(coop.note!,/Cooperative/);
  const english=result.courses.find(c=>c.code==='انجل-111')!;
  assert.equal(english.resourceOwner,'الدراسات العامة');
});

test('plan hours and operational hours stay separate and an unapproved discrepancy blocks completeness',()=>{
  const plan=importAutomaticCurriculumCsv(csv());
  const demands=resolveLevelDemand([1,2,3,4,5],[historical]).levels;
  const result=calculateAutomaticPlan(plan,demands,capacities,[
    {code:'ادار-101',mode:'REMOTE_THEORY',theoryHours:4}
  ],{'مسار المستوى الخامس':'تعاو-501'});
  const course=result.courses.find(c=>c.code==='ادار 101')!;
  assert.deepEqual(course.discrepancy,{planTheory:3,planTutorial:0,planPractical:0,
    scenarioTheory:4,scenarioPractical:0,reason:null,approved:false});
  assert.equal(course.complete,false);assert.ok(result.missingInputs.includes('UNAPPROVED_HOUR_DIFFERENCE:ادار 101'));
});

test('missing learner data asks for a level-count source, never manual per-course demand',()=>{
  const plan=importAutomaticCurriculumCsv(csv());
  const result=calculateAutomaticPlan(plan,[],capacities,[],{'مسار المستوى الخامس':'تعاو-501'});
  assert.deepEqual(result.missingInputs,['MISSING_LEVEL_COUNTS:1,2,3,4,5']);
  assert.ok(result.courses.every(c=>c.demand===0));
});

test('updated level counts recalculate every eligible course and section total automatically',()=>{
  const plan=importAutomaticCurriculumCsv(csv());
  const first=resolveLevelDemand([1],[historical]).levels;
  const updated=resolveLevelDemand([1],[{kind:'ACTUAL_LEVEL_COUNTS',counts:{1:201},label:'كشف حديث',confidence:'HIGH'}]).levels;
  const selected={'مسار المستوى الخامس':'تعاو-501'};
  const a=calculateAutomaticPlan(plan,first,capacities,[{code:'ادار-101',mode:'REMOTE_THEORY'}],selected);
  const b=calculateAutomaticPlan(plan,updated,capacities,[{code:'ادار-101',mode:'REMOTE_THEORY'}],selected);
  assert.equal(a.courses.find(c=>c.code==='ادار 101')?.academicGroups,2);
  assert.equal(b.courses.find(c=>c.code==='ادار 101')?.academicGroups,3);
  assert.equal(b.courses.filter(c=>c.level===1).every(c=>c.demand===201),true);
});

test('an alternative decision is required and the two level-five paths are never counted together',()=>{
  const plan=importAutomaticCurriculumCsv(csv());
  const demands=resolveLevelDemand([1,2,3,4,5],[historical]).levels;
  const undecided=calculateAutomaticPlan(plan,demands,capacities);
  assert.ok(undecided.missingInputs.includes('MISSING_ALTERNATIVE_SELECTION:مسار المستوى الخامس'));
  assert.equal(undecided.courses.filter(c=>c.level===5).length,2);
  const decided=calculateAutomaticPlan(plan,demands,capacities,[],{'مسار المستوى الخامس':'تعاو-501'});
  assert.equal(decided.courses.filter(c=>c.level===5).length,1);
});

test('equivalents are metadata and do not become extra curriculum rows',()=>{
  const source=csv().replace('ادار 101,مبادئ إدارة الأعمال,الفصل التدريبي الأول,3,0,0,4,,,',
    'ادار 101,مبادئ إدارة الأعمال,الفصل التدريبي الأول,3,0,0,4,,ادار-001,');
  const plan=importAutomaticCurriculumCsv(source) as AutomaticCurriculum;
  assert.equal(plan.courses.length,26);
  assert.deepEqual(plan.courses[0]?.equivalents,['ادار-001'.toUpperCase()]);
});

test('trainee schedule rows deduplicate repeated meetings and infer levels from the uploaded curriculum',()=>{
  const table=[
    ['الرقم التدريبي','المقرر','اليوم'],
    ['1001','ادار-101','الأحد'],
    ['1001','ادار-101','الثلاثاء'],
    ['1001','اقتص-101','الاثنين'],
    ['1002','ادار-201','الأحد'],
    ['1003','ادار-101','الأحد'],
    ['1003','ادار-201','الاثنين'],
  ];
  const result=extractTraineeDemand(table,{'ادار-101':1,'اقتص-101':1,'ادار-201':2});
  assert.deepEqual(result.counts,{1:1,2:2});
  assert.deepEqual(result.courseCounts,{'ادار-101':2,'ادار-201':2,'اقتص-101':1});
  assert.equal(result.uniqueTrainees,3);assert.equal(result.matchedTrainees,3);
  assert.equal(result.traineesAcrossMultipleLevels,1);assert.equal(result.strategy,'ALL_TRAINEE_ROWS');
});

test('completion files prefer explicitly registered rows and never count all curriculum rows per trainee',()=>{
  const table=[
    ['مسجل','مستوفى','وصف المستوى','المقرر','رقم المتدرب'],
    ['نعم','لا','الخطة-1','ادار-101','1001'],
    ['نعم','لا','الخطة-1','ادار-101','1001'],
    ['','لا','الخطة-2','ادار-201','1001'],
    ['نعم','لا','الخطة-2','ادار-201','1002'],
    ['','نعم','الخطة-1','ادار-101','1003'],
  ];
  const result=extractTraineeDemand(table);
  assert.deepEqual(result.counts,{1:1,2:1});
  assert.equal(result.strategy,'REGISTERED_ROWS');assert.equal(result.uniqueTrainees,3);
  assert.equal(result.matchedTrainees,2);assert.equal(result.ignoredRows,2);
});

test('registration files without a level require curriculum mapping instead of inventing counts',()=>{
  assert.throws(()=>extractTraineeDemand([
    ['الرقم التدريبي','المقرر'],['1001','ادار-101'],
  ]),/ارفع الخطة أولًا/);
});
