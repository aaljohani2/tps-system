import test from 'node:test';
import assert from 'node:assert/strict';
import {columns,decodeCsv,previewBulk} from '../src/bulk-import.js';

const row=(kind:keyof typeof columns,values:string[])=>[columns[kind],values];
test('CSV resource rows validate without mutating the database',()=>{
  const csv='code,name,type,capacity,building,available\r\nR-12,قاعة نظرية,CLASSROOM,32,B-1,\r\n';
  const preview=previewBulk('rooms',decodeCsv(Buffer.from(csv)));
  assert.equal(preview.ready,true);
  assert.equal(preview.validRows,1);
  assert.equal(preview.errors.length,0);
  assert.deepEqual(preview.rows[0],{code:'R-12',name:'قاعة نظرية',type:'CLASSROOM',
    capacity:32,building:'B-1',available:null});
});
test('all rows are checked and duplicate instructor codes reject commit',()=>{
  const table=[columns.instructors,
    ['I-1','Trainer 1','قسم اصطناعي','18','','ONSITE|REMOTE',''],
    ['I-1','Trainer 2','قسم اصطناعي','20','','ONSITE','']];
  const p=previewBulk('instructors',table);
  assert.equal(p.ready,false);
  assert.equal(p.validRows,1);
  assert.equal(p.errors[0]?.row,3);
  assert.match(p.errors[0]?.message??'',/Duplicate/);
});
test('malformed availability and formula-like names are rejected with row numbers',()=>{
  const table=[columns.rooms,['R-1','=2+2','LAB','20','',''],
    ['R-2','Lab','LAB','20','','[{"day":"THU","from":10,"to":12}]']];
  const p=previewBulk('rooms',table);
  assert.equal(p.ready,false);
  assert.deepEqual(p.errors.map(x=>x.row),[2,3]);
});
test('block template requires linked courses and nonzero size',()=>{
  const p=previewBulk('blocks',row('blocks',['G-1','1','B-1','Block 1','0','COURSE-1']));
  assert.equal(p.ready,false);
  assert.equal(p.errors.length,1);
  const q=previewBulk('blocks',row('blocks',['G-1','1','B-1','Block 1','30','COURSE-1|COURSE-2']));
  assert.equal(q.ready,true);
});
test('demand template uses configurable 5% default without multiplying components',()=>{
  const q=previewBulk('demand',row('demand',['COURSE-1','2','24','','Academic planning','HIGH']));
  assert.equal(q.ready,true);
  assert.equal(q.rows[0] && 'repeatRate' in q.rows[0]?q.rows[0].repeatRate:undefined,0.05);
});
test('invalid UTF8, incorrect headers and excessive rows fail closed',()=>{
  assert.throws(()=>decodeCsv(Buffer.from([0xFF,0xFE])),/encoded|valid|UTF|fatal/i);
  assert.throws(()=>previewBulk('rooms',[['code','wrong'],['R-1','Lab']]),/Template columns/);
  assert.throws(()=>previewBulk('rooms',[columns.rooms,
    ...Array.from({length:501},()=>['R-1','Lab','LAB','20','',''])]),/500 data rows/);
});

test('course template enforces department contact hours and separate proposed eligibility',()=>{
  const ok=previewBulk('courses',[columns.courses,
    ['C-2','Accounting basics','2','تقنية الأعمال','2','1','25','REMOTE','ONSITE|REMOTE']]);
  assert.equal(ok.ready,true);
  assert.equal(ok.rows[0] && 'proposedMode' in ok.rows[0]?ok.rows[0].proposedMode:null,'REMOTE');
  const rejected=previewBulk('courses',[columns.courses,
    ['C-3','Invalid modes','2','تقنية الأعمال','2','0','25','REMOTE','REMOTE']]);
  assert.equal(rejected.ready,false);
});
