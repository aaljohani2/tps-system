import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {bulkReadXlsx,bulkTemplateXlsx} from '../src/bulk-xlsx.js';

test('Arabic XLSX import uses UTF-8 regardless of legacy Windows child code page',async()=>{
  const python=process.env.TPS_PYTHON??(process.platform==='win32'?'python':'python3');
  const bytes=execFileSync(python,['-c',
    "import io,sys;from openpyxl import Workbook;w=Workbook();s=w.active;s.title='البيانات';"+
    "s.append(['code','name','type','capacity','building','available']);"+
    "s.append(['R-UTF8','قاعة تدريب عربية','CLASSROOM',30,'مبنى ١','']);"+
    "out=io.BytesIO();w.save(out);sys.stdout.buffer.write(out.getvalue())"
  ],{maxBuffer:2*1024*1024});
  const previousUtf8=process.env.PYTHONUTF8,previousIo=process.env.PYTHONIOENCODING;
  try{
    // Simulate launching Node from a console configured with a legacy code page.
    // The bridge must explicitly override both values for each child.
    process.env.PYTHONUTF8='0';
    process.env.PYTHONIOENCODING='cp1252';
    const rows=await bulkReadXlsx('rooms',bytes);
    assert.deepEqual(rows[1]?.slice(0,5),['R-UTF8','قاعة تدريب عربية','CLASSROOM','30','مبنى ١']);
    const template=await bulkTemplateXlsx('rooms');
    assert.equal(template.subarray(0,2).toString('ascii'),'PK','binary template must remain byte-accurate');
  }finally{
    if(previousUtf8===undefined)delete process.env.PYTHONUTF8;
    else process.env.PYTHONUTF8=previousUtf8;
    if(previousIo===undefined)delete process.env.PYTHONIOENCODING;
    else process.env.PYTHONIOENCODING=previousIo;
  }
});
