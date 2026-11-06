import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import type {PlanResult} from '../types.js';

export async function exportScenarioXlsx(result:PlanResult,metadata?:{state:string;scenarioName:string;termId:string;policyRevision:number;
  readiness?:{technicalReady:boolean;issues:Array<{code:string;severity:string;message:string;sectionId?:string;courseCode?:string}>};
  comparisonRows?:Array<[string,string|number,string|number]>}):Promise<Buffer>{
  const executable=process.env.TPS_PYTHON??(process.platform==='win32'?'python':'python3');
  const script=resolve('scripts/export_scenario.py');
  return new Promise<Buffer>((resolveResult,reject)=>{
    const child=spawn(executable,[script],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    const chunks:Buffer[]=[],errors:Buffer[]=[];let length=0,done=false;
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Excel export timed out'));},20000);
    function finish(error?:Error,data?:Buffer){
      if(done)return;done=true;clearTimeout(timer);
      if(error)reject(error);else resolveResult(data??Buffer.alloc(0));
    }
    child.on('error',e=>finish(e));
    child.stdout.on('data',(chunk:Buffer)=>{
      length+=chunk.length;
      if(length>10000000){child.kill('SIGKILL');finish(new Error('Excel export exceeded file limit'));}
      else chunks.push(chunk);
    });
    child.stderr.on('data',(chunk:Buffer)=>{if(Buffer.concat(errors).length<2000)errors.push(chunk);});
    child.on('close',code=>{
      if(code===0)finish(undefined,Buffer.concat(chunks));
      else finish(new Error('Excel exporter failed: '+Buffer.concat(errors).toString('utf8').slice(0,500)));
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(metadata?{plan:result,metadata}:result));
  });
}
