import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile);
const moduleDirectory=resolve(fileURLToPath(new URL('.',import.meta.url)));
const scriptCandidates=[
  resolve(moduleDirectory,'../scripts/read_automatic_workbook.py'),
  resolve(moduleDirectory,'../../scripts/read_automatic_workbook.py'),
];
const defaultScript=scriptCandidates.find(existsSync)??scriptCandidates[0]!;
export interface WorkbookTable {name:string;rows:string[][]}

export async function readAutomaticWorkbook(bytes:Buffer,options:{python?:string;script?:string;maxBytes?:number}={}):Promise<WorkbookTable[]>{
  const maxBytes=options.maxBytes??20*1024*1024;
  if(!bytes.length||bytes.length>maxBytes)throw new Error(`XLSX must be 1 byte to ${Math.floor(maxBytes/1024/1024)} MiB`);
  if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('Invalid XLSX signature');
  const dir=await mkdtemp(join(tmpdir(),'tps-auto-'));
  const path=join(dir,'source.xlsx');
  try{
    await writeFile(path,bytes);
    const script=options.script??defaultScript;
    const {stdout}=await run(options.python??process.env.PYTHON_COMMAND??'python',[script,path],{
      timeout:60_000,maxBuffer:64*1024*1024,windowsHide:true,
      env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}
    });
    const parsed=JSON.parse(stdout) as {sheets?:WorkbookTable[];error?:string};
    if(parsed.error)throw new Error(parsed.error);
    if(!Array.isArray(parsed.sheets))throw new Error('Unexpected workbook reader output');
    return parsed.sheets;
  }catch(error){
    const stderr=(error as {stderr?:string}).stderr?.trim();
    const detail=stderr||(error instanceof Error?error.message:String(error));
    throw new Error(detail.slice(0,400));
  }finally{await rm(dir,{recursive:true,force:true});}
}
