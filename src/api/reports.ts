import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import type {ScenarioReport} from '../scenario-reports.js';

let running=0;
export async function exportScheduleReport(report:ScenarioReport,format:'xlsx'|'pdf'):Promise<Buffer>{
 if(running>=2)throw Object.assign(new Error('يوجد تقريران قيد التجهيز؛ أعد المحاولة بعد اكتمالهما.'),{statusCode:429});
 running++;
 try{return await new Promise<Buffer>((accept,reject)=>{
  const child=spawn(process.env.TPS_PYTHON??(process.platform==='win32'?'python':'python3'),[resolve('scripts/export_schedule_report.py'),'--format',format],
   {stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
  const chunks:Buffer[]=[],errors:Buffer[]=[];let length=0,finished=false;
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Schedule report export timed out'));},60000);
  function finish(error?:Error){if(finished)return;finished=true;clearTimeout(timer);if(error)reject(error);else accept(Buffer.concat(chunks));}
  child.on('error',finish);child.stdout.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>25_000_000){child.kill('SIGKILL');finish(new Error('Schedule report exceeds file limit'));}else chunks.push(chunk);});
  child.stderr.on('data',(chunk:Buffer)=>{if(errors.reduce((n,b)=>n+b.length,0)<2000)errors.push(chunk);});
  child.on('close',code=>finish(code===0?undefined:new Error('Schedule report export failed: '+Buffer.concat(errors).toString('utf8').slice(0,700))));
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(report));
 });}finally{running--;}
}
