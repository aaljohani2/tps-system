import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {BulkKind} from './bulk-import.js';

const exec=promisify(execFile);
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const script=resolve(root,'scripts/bulk_xlsx.py');
const python=()=>process.env.TPS_PYTHON??(process.platform==='win32'?'python':'python3');
async function run(args:string[],maxBuffer=8*1024*1024){
  try{return await exec(python(),[script,...args],{cwd:root,timeout:20_000,
    maxBuffer,encoding:'buffer',windowsHide:true});}
  catch(e){
    const err=e as Error&{stderr?:Buffer;code?:string};
    if(err.code==='ENOENT')throw new Error('Python not found');
    const detail=err.stderr?.toString('utf-8').slice(0,500)??'';
    throw new Error(detail||'Invalid XLSX workbook');
  }
}
export async function bulkTemplateXlsx(kind:BulkKind):Promise<Buffer>{
  const {stdout}=await run(['template',kind]);
  return Buffer.from(stdout);
}
export async function bulkReadXlsx(kind:BulkKind,bytes:Buffer):Promise<string[][]>{
  if(!bytes.length||bytes.length>5*1024*1024)throw new Error('XLSX must be 1 byte to 5 MiB');
  if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('Invalid XLSX signature');
  const dir=await mkdtemp(join(tmpdir(),'tps-import-'));
  try{
    const file=join(dir,'upload.xlsx');
    await writeFile(file,bytes,{mode:0o600});
    const {stdout}=await run(['read',kind,file]);
    const parsed=JSON.parse(stdout.toString('utf8')) as {rows?:unknown};
    if(!Array.isArray(parsed.rows)||!parsed.rows.every(r=>Array.isArray(r)&&r.every(c=>typeof c==='string')))
      throw new Error('Unexpected XLSX converter output');
    return parsed.rows as string[][];
  }finally{await rm(dir,{recursive:true,force:true});}
}
