import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverRayatResources} from '../src/raiyat-resources.js';

test('Rayat schedule can infer unique trainer and room codes without a fixed template',()=>{
  const rows=[
    ['الفصل التدريبي','الوحدة التدريبية','القسم','رقم المدرب','اسم المدرب',
      'المقرر','القاعة','اسم القاعة','سعة القاعة','نوع القاعة','المبنى','النصاب'],
    ['144820','كلية التجربة','تقنية الأعمال','T01','مدرب أول','ادار-101','H-201','قاعة تدريبية', '45','نظرية','B','18'],
    ['144820','كلية التجربة','تقنية الأعمال','T01','مدرب أول','ادار-101','H-201','قاعة تدريبية', '45','نظرية','B','18'],
    ['144820','كلية التجربة','تقنية الأعمال','T02','مدرب ثان','ادار-111','LAB-10','معمل الحاسب', '30','معمل','A','22'],
    ['144820','كلية أخرى','تقنية الأعمال','T03','مدرب خارج الكلية','ادار-101','X-1','قاعة أخرى','55','نظرية','C','20'],
    ['144820','كلية التجربة','قسم الحاسب','T04','مدرب قسم آخر','برمج-101','SHARED','معمل مشترك','30','معمل','A','20']
  ];
  const result=discoverRayatResources([{name:'جدول المدربين',rows}],{
    college:'كلية التجربة',department:'تقنية الأعمال'});
  assert.equal(result.instructors.length,2);
  assert.deepEqual(result.instructors.map(x=>x.code),['T01','T02']);
  assert.equal(result.instructors[0]!.maxLoad,18);
  assert.deepEqual(result.instructors[0]!.courseEvidence,['ادار-101'.toUpperCase()]);
  assert.equal(result.instructors[0]!.sourceRows,2,'Repeated lessons are deduplicated');
  assert.deepEqual(result.rooms.map(x=>x.code),['H-201','LAB-10','SHARED']);
  assert.equal(result.rooms[0]!.capacity,45);
  assert.equal(result.rooms[1]!.type,'LAB');
  assert.ok(result.rooms.every(x=>x.scopeVerified));
  assert.equal(result.unscoped,false);
});
test('scope-less sheets flag explicit confirmation and never invent a missing room capacity',()=>{
  const result=discoverRayatResources([{name:'Rooms',rows:[
    ['رقم القاعة','اسم القاعة','المبنى'],
    ['101','معمل الطباعة','B'],
    ['101','معمل الطباعة','B']
  ]}],{department:'تقنية الأعمال',college:'كلية التجربة'});
  assert.equal(result.rooms.length,1);
  assert.equal(result.rooms[0]!.capacity,null);
  assert.equal(result.rooms[0]!.type,null);
  assert.equal(result.unscoped,true);
  assert.match(result.warnings.join(' '),/سعة|السعة/);
});
test('explicitly inconsistent capacity fails instead of choosing an arbitrary row',()=>{
  assert.throws(()=>discoverRayatResources([{name:'rooms',rows:[
    ['الكلية','رقم القاعة','سعة القاعة','نوع القاعة'],
    ['كلية التجربة','R100','30','معمل'],
    ['كلية التجربة','R100','40','معمل']
  ]}],{department:'تقنية الأعمال',college:'كلية التجربة'}),/سعات مختلفة/);
});
test('same instructor code with two names fails rather than corrupting resource register',()=>{
  assert.throws(()=>discoverRayatResources([{name:'Staff',rows:[
    ['الكلية','القسم','رقم المدرب','اسم المدرب'],
    ['كلية التجربة','تقنية الأعمال','T15','الأول'],
    ['كلية التجربة','تقنية الأعمال','T15','الثاني']
  ]}],{department:'تقنية الأعمال',college:'كلية التجربة'}),/أسماء مختلفة/);
});
test('false Rayat spreadsheet with no recognized code columns is not silently accepted',()=>{
  assert.throws(()=>discoverRayatResources([{name:'Chart',rows:[
    ['مواعيد التدريب','بيانات الاختبار'],['أحد','ثمانية']
  ]}],{department:'تقنية الأعمال',college:'كلية التجربة'}),/لا يحتوي الملف/);
});
