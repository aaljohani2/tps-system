/** Bounded, deterministic bulk import validation. Previews make no database mutations. */
import {z} from 'zod';
import {parseCsv} from './importer.js';
export const kinds=['courses','instructors','rooms','blocks','demand'] as const;
export type BulkKind=typeof kinds[number];
export const columns:Record<BulkKind,string[]>={
  courses:['code','title','level','department','theoryHours','practicalHours','demand','proposedMode','eligibleModes'],
  instructors:['code','name','maxLoad','eligibleCourseCodes','allowedModes','available'],
  rooms:['code','name','type','capacity','building','available'],
  blocks:['cohortCode','level','code','name','size','courseCodes'],
  demand:['courseCode','level','baseStudents','repeatRate','source','confidence']
};
const nonFormula=(s:string)=>!/^\s*[=+@-]/.test(s);
const text=(v:unknown,max=240)=>z.string().trim().min(1).max(max).refine(nonFormula,'Formula-like text forbidden').parse(v);
const optionalText=(v:unknown,max=240)=>!String(v??'').trim()?null:text(v,max);
const code=(v:unknown)=>z.string().trim().min(1).max(60)
  .regex(/^[^\s:/]+$/,'Code cannot contain whitespace, colon or slash')
  .refine(nonFormula,'Formula-like code forbidden').parse(v);
function number(v:unknown,max:number,integer=false):number{
  const s=String(v??'').trim();
  if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s))throw new Error('Expected a nonnegative number');
  const n=Number(s);
  if(!Number.isFinite(n)||n>max||(integer&&!Number.isInteger(n)))throw new Error('Number outside permitted range');
  return n;
}
function list(v:unknown,allowed?:string[]):string[]{
  const s=String(v??'').trim();
  if(!s)return [];
  const items=s.split('|').map(x=>x.trim()).filter(Boolean);
  if(items.length>100||new Set(items).size!==items.length)throw new Error('Duplicate or excessive list members');
  for(const item of items){
    if(allowed&&!allowed.includes(item))throw new Error('Invalid list member: '+item);
    if(!allowed)code(item);
  }
  return items;
}
const days=['SUN','MON','TUE','WED','THU'] as const;
const window=z.object({day:z.enum(days),from:z.number().min(0).max(23.5),
  to:z.number().min(0.5).max(24)}).strict().refine(w=>
    Number.isInteger(w.from*2)&&Number.isInteger(w.to*2)&&w.to>w.from&&
    (w.day!=='THU'||w.to<=10),'Invalid half-hour availability window');
function availability(raw:unknown){
  if(!String(raw??'').trim())return null;
  let parsed:unknown;
  try{parsed=JSON.parse(String(raw));}catch{throw new Error('Availability must be valid JSON');}
  return z.array(window).max(30).parse(parsed);
}
export type CourseBulk={code:string;title:string;level:number;department:string;theoryHours:number;
  practicalHours:number;demand:number;proposedMode:'ONSITE'|'REMOTE'|'SELF_PACED'|'HYBRID';
  eligibleModes:string[]};
export type TrainerBulk={code:string;name:string;maxLoad:number;eligibleCourseCodes:string[]|null;
  allowedModes:string[];available:ReturnType<typeof availability>};
export type RoomBulk={code:string;name:string;type:'CLASSROOM'|'LAB'|'MULTI';capacity:number;
  building:string|null;available:ReturnType<typeof availability>};
export type BlockBulk={cohortCode:string;level:number;code:string;name:string;size:number;courseCodes:string[]};
export type DemandBulk={courseCode:string;level:number;baseStudents:number;repeatRate:number;
  source:string;confidence:'LOW'|'MEDIUM'|'HIGH'};
export type BulkRow=CourseBulk|TrainerBulk|RoomBulk|BlockBulk|DemandBulk;
export type BulkPreview={schemaVersion:'tps.bulk.v1';kind:BulkKind;headers:string[];
  rows:BulkRow[];errors:Array<{row:number;message:string}>;totalRows:number;
  validRows:number;ready:boolean};
export function decodeCsv(bytes:Buffer):string[][]{
  if(bytes.length===0||bytes.length>5*1024*1024)throw new Error('CSV must be 1 byte to 5 MiB');
  const csv=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  return parseCsv(csv);
}
function normalize(kind:BulkKind,cell:Record<string,string>):BulkRow{
  if(kind==='courses'){
    const level=number(cell.level,12,true),theoryHours=number(cell.theoryHours,80,true),
      practicalHours=number(cell.practicalHours,80,true);
    if(level<1||theoryHours+practicalHours===0)throw new Error('Course needs level 1-12 and weekly contact hours');
    const modes=['ONSITE','REMOTE','SELF_PACED','HYBRID'] as const;
    const proposedMode=z.enum(modes).parse(String(cell.proposedMode??'').trim()||'ONSITE');
    const eligibleModes=list(cell.eligibleModes,[...modes]);
    if(!eligibleModes.length||!eligibleModes.includes(proposedMode)||!eligibleModes.includes('ONSITE'))
      throw new Error('Eligible mode proposals must include ONSITE and the proposed mode');
    return {code:code(cell.code),title:text(cell.title),level,department:text(cell.department),
      theoryHours,practicalHours,demand:number(cell.demand,5000,true),proposedMode,eligibleModes};
  }
  if(kind==='instructors'){
    const allowedModes=list(cell.allowedModes,['ONSITE','REMOTE','SELF_PACED','HYBRID']);
    if(!allowedModes.length)throw new Error('Trainer requires at least one allowed mode');
    return {code:code(cell.code),name:text(cell.name),maxLoad:number(cell.maxLoad,60),
      eligibleCourseCodes:list(cell.eligibleCourseCodes).length?list(cell.eligibleCourseCodes):null,
      allowedModes,available:availability(cell.available)};
  }
  if(kind==='rooms'){
    const type=z.enum(['CLASSROOM','LAB','MULTI']).parse(cell.type);
    const capacity=number(cell.capacity,5000,true);
    if(!capacity)throw new Error('Room capacity must be positive');
    return {code:code(cell.code),name:text(cell.name),type,capacity,
      building:optionalText(cell.building),available:availability(cell.available)};
  }
  if(kind==='blocks'){
    const size=number(cell.size,5000,true);
    if(!size)throw new Error('Block size must be positive');
    const courseCodes=list(cell.courseCodes);
    if(number(cell.level,12,true)<1)throw new Error('Block level must be 1–12');
    if(!courseCodes.length)throw new Error('A block import must explicitly assign at least one course');
    return {cohortCode:code(cell.cohortCode),level:number(cell.level,12,true),code:code(cell.code),name:text(cell.name),
      size,courseCodes};
  }
  const level=number(cell.level,12,true);
  if(!level)throw new Error('Level must be 1–12');
  const repeatRate=String(cell.repeatRate??'').trim()?number(cell.repeatRate,0.5):0.05;
  const confidence=z.enum(['LOW','MEDIUM','HIGH']).parse(String(cell.confidence??'').trim()||'MEDIUM');
  return {courseCode:code(cell.courseCode),level,
    baseStudents:number(cell.baseStudents,5000,true),repeatRate,
    source:text(cell.source),confidence};
}
export function previewBulk(kind:BulkKind,table:unknown[][]):BulkPreview{
  if(!kinds.includes(kind))throw new Error('Unsupported import entity');
  if(table.length<2)throw new Error('File must have a header and at least one data row');
  if(table.length>501)throw new Error('Import exceeds 500 data rows');
  const headers=columns[kind];
  const actual=table[0]?.map(x=>String(x??'').trim())??[];
  if(actual.length!==headers.length||headers.some((h,i)=>h!==actual[i]))
    throw new Error('Template columns do not match '+kind+': expected '+headers.join(', '));
  const rows:BulkRow[]=[], errors:Array<{row:number;message:string}>=[];
  const seen=new Set<string>();
  let totalRows=0;
  for(let i=1;i<table.length;i++){
    const raw=table[i]??[];
    if(raw.every(v=>!String(v??'').trim()))continue;
    totalRows++;
    try{
      if(raw.length>headers.length&&raw.slice(headers.length).some(x=>String(x??'').trim()))
        throw new Error('Unexpected extra columns');
      const data=Object.fromEntries(headers.map((h,j)=>[h,String(raw[j]??'').trim()]));
      const value=normalize(kind,data);
      const key=kind==='blocks'?(value as BlockBulk).cohortCode+'::'+(value as BlockBulk).code:
        kind==='demand'?(value as DemandBulk).courseCode:(value as CourseBulk|TrainerBulk|RoomBulk).code;
      if(seen.has(key))throw new Error('Duplicate key in uploaded file: '+key);
      seen.add(key);
      rows.push(value);
    }catch(e){
      const message=e instanceof Error?e.message:String(e);
      errors.push({row:i+1,message:message.slice(0,350)});
    }
  }
  if(!totalRows)throw new Error('File has no records');
  return {schemaVersion:'tps.bulk.v1',kind,headers,rows,errors,totalRows,
    validRows:rows.length,ready:errors.length===0&&rows.length>0};
}
