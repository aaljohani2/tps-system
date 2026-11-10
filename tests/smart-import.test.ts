import test from 'node:test';
import assert from 'node:assert/strict';
import {readSmartCsv} from '../src/smart-csv.js';
import {isGenericCollege,sameCollege} from '../src/import-scope.js';
import {extractTraineeDemand,importAutomaticCurriculumCsv,parseLevel} from '../src/automatic-planning.js';
import {discoverRayatResources} from '../src/raiyat-resources.js';

test('localized CSV accepts a preamble, semicolons, quoted commas and multiline cells without losing zero prefixes',()=>{
  const result=readSmartCsv(Buffer.from('\uFEFFتقرير محلي\r\nرقم المدرب;اسم المدرب;ملاحظة\r\n0012;"مدرب، تجريبي";"line, one\nline two"'));
  assert.equal(result.delimiter,';');
  assert.deepEqual(result.rows[2],['0012','مدرب، تجريبي','line, one\nline two']);
  const tab=readSmartCsv(Buffer.from('sep=\t\ncode\tname\n0001\tTest'));
  assert.equal(tab.delimiter,'\t');assert.equal(tab.rows[1]?.[0],'0001');
});
test('Unicode Excel and legacy Arabic CSV decode locally and binary/corrupt quotes fail',()=>{
  const csv='رمز المقرر\tالمستوى\nادار-101\t١';
  assert.equal(readSmartCsv(Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(csv,'utf16le')])).rows[1]?.[1],'١');
  // Windows-1256 bytes for the Arabic heading اسم, without depending on a new encoding library.
  assert.equal(readSmartCsv(Buffer.from([0xc7,0xd3,0xe3,0x2c,0x63,0x6f,0x64,0x65,0x0a,0x61,0x2c,0x30,0x31])).rows[0]?.[0],'اسم');
  assert.throws(()=>readSmartCsv(Buffer.from('a,b\n"unclosed')),/Malformed/);
  assert.throws(()=>readSmartCsv(Buffer.from([0,1,2])),/encoding/);
});
test('college prefixes match the same location only; generic and different colleges never merge',()=>{
  assert.equal(sameCollege('كلية مدينة المثال','الكلية التقنية بمدينة المثال'),true);
  assert.equal(sameCollege('كلية مدينة المثال','الكلية التقنية بمدينة أخرى'),false);
  assert.equal(sameCollege('الكلية التقنية','كلية مدينة المثال'),false);
  assert.equal(isGenericCollege('الكلية التقنية'),true);
});
test('curriculum finds shifted headers, repeated export headings and invisible RTL marks',()=>{
  const header='\u200fاسم المقرر,مح,المقرر,الفصل التدريبي,عم';
  const result=importAutomaticCurriculumCsv(['تقرير الخطة',header,'مقرر أول,2,C-01,الأول,0',header,'مقرر ثان,1,C-02,الحادي عشر,2'].join('\n'));
  assert.deepEqual(result.courses.map(c=>c.level),[1,11]);
  assert.deepEqual(result.courses.map(c=>c.sourceRow),[3,5]);
  assert.equal(parseLevel('الثاني عشر'),12);
});
test('completed-only reports never become current registrations when no registered rows exist',()=>{
  assert.throws(()=>extractTraineeDemand([
    ['رقم المتدرب','المقرر','مستوفى'],['0001','C-1','نعم']
  ],{'C-1':1}),/تعذر ربط/);
});
test('conflicting timetable capacities are reviewable and cannot be chosen by row order',()=>{
  const rows=[['الوحدة التدريبية','رمز القاعة','وصف القاعة','السعة','المسجلين','ساعات الاتصال'],
    ['كلية مدينة المثال','0001','قاعة تدريب','40','35','3'],
    ['كلية مدينة المثال','0001','قاعة تدريب','50','35','3'],
    ['كلية مدينة المثال','0001','قاعة تدريب','40','35','3']];
  const target={college:'الكلية التقنية بمدينة المثال',department:'قسم تجريبي'};
  const result=discoverRayatResources([{name:'any-name',rows}],target,{reviewConflicts:true});
  assert.equal(result.rooms.length,1);assert.equal(result.rooms[0]?.capacity,null);
  assert.deepEqual(result.rooms[0]?.capacityCandidates,[40,50]);
  assert.equal(result.rooms[0]?.type,null);assert.equal(result.unscoped,false);
  assert.match(result.warnings.join(' '),/تعارضت سعة/);
  const reversed=discoverRayatResources([{name:'any-name',rows:[rows[0]!,...rows.slice(1).reverse()]}],target,{reviewConflicts:true});
  assert.deepEqual(result.rooms,reversed.rooms);
});
test('trainee timetable room aliases discover facilities without inventing trainer identifiers or capacities',()=>{
  const result=discoverRayatResources([{name:'renamed',rows:[
    ['الوحدة التدريبية','القسم','الرقم التدريبي','الغرفة','اسم الغرفة','المدربـ/ـه','المسجلين'],
    ['كلية مدينة المثال','قسم تجريبي','0001','0010','معمل حاسب','اسم تجريبي','40']
  ]}],{college:'الكلية التقنية بمدينة المثال',department:'قسم تجريبي'},{reviewConflicts:true});
  assert.equal(result.rooms[0]?.code,'0010');assert.equal(result.rooms[0]?.capacity,null);
  assert.equal(result.instructors.length,0);
});
