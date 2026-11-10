import type {FastifyInstance,FastifyRequest} from 'fastify';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './database.js';
import {allowedDepartment,allowedCollege,requireEditor} from './security.js';
import {readAutomaticWorkbook,type WorkbookTable} from '../automatic-xlsx.js';
import {discoverRayatResources} from '../raiyat-resources.js';
import {readSmartCsv} from '../smart-csv.js';

const uuid=z.string().uuid();
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
function mime(name:string){return name.toLowerCase().endsWith('.xlsx')?'xlsx':name.toLowerCase().endsWith('.csv')?'csv':null;}
async function sheets(bytes:Buffer,kind:'csv'|'xlsx'):Promise<WorkbookTable[]>{
  if(!bytes.length||bytes.length>20*1024*1024)throw fail('Excel/CSV file exceeds 20 MiB',413);
  return kind==='xlsx'?readAutomaticWorkbook(bytes):
    [{name:'CSV',rows:readSmartCsv(bytes).rows}];
}
async function discover(bytes:Buffer,kind:'csv'|'xlsx',scope:{department:string;college:string}){
  try{return discoverRayatResources(await sheets(bytes,kind),scope,{reviewConflicts:true});}
  catch(error){
    if((error as {statusCode?:number}).statusCode)throw error;
    throw fail(error instanceof Error?error.message:'Invalid resource file',400);
  }
}
async function getScope(req:FastifyRequest,departmentId:string,collegeId:string){
  if(!await allowedDepartment(req.principal!,departmentId)||
    !await allowedCollege(req.principal!,collegeId))throw fail('Scope denied',403);
  const d=await pool.query<{department:string;college:string}>(
    'SELECT d.name department,c.name college FROM departments d JOIN colleges c ON c.id=d.college_id WHERE d.id=$1 AND c.id=$2',
    [departmentId,collegeId]);
  if(!d.rows[0])throw fail('Selected department does not belong to selected college',409);
  return d.rows[0];
}
function mayImportRooms(req:FastifyRequest){
  return ['SYSTEM_ADMIN','COLLEGE_ADMIN'].includes(req.principal!.role)&&
    (!req.principal!.departmentId||req.principal!.role==='SYSTEM_ADMIN');
}
export async function registerRayatResourceImports(app:FastifyInstance){
  app.post('/api/v1/raiyat-resources/preview',{bodyLimit:20*1024*1024},async req=>{
    requireEditor(req);
    const query=z.object({departmentId:uuid,collegeId:uuid}).parse(req.query);
    const scope=await getScope(req,query.departmentId,query.collegeId);
    if(!Buffer.isBuffer(req.body))throw fail('Upload CSV or XLSX as binary',415);
    const media=String(req.headers['content-type']??'').split(';')[0];
    const kind=media==='text/csv'?'csv':
      media==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'?'xlsx':null;
    if(!kind)throw fail('Only CSV or XLSX',415);
    const buffer=req.body as Buffer;
    const result=await discover(buffer,kind,scope);
    const [trainers,rooms]=await Promise.all([
      pool.query<{code:string}>('SELECT code FROM instructors WHERE department_id=$1',[query.departmentId]),
      pool.query<{code:string}>('SELECT code FROM rooms WHERE college_id=$1',[query.collegeId])
    ]);
    const trainerCodes=new Set(trainers.rows.map(x=>x.code));
    const roomCodes=new Set(rooms.rows.map(x=>x.code));
    return {...result,sha256:createHash('sha256').update(buffer).digest('hex'),
      existingInstructors:result.instructors.filter(x=>trainerCodes.has(x.code)).length,
      existingRooms:result.rooms.filter(x=>roomCodes.has(x.code)).length,
      canImportRooms:mayImportRooms(req),
      instructors:result.instructors.map(x=>({...x,exists:trainerCodes.has(x.code)})),
      rooms:result.rooms.map(x=>({...x,exists:roomCodes.has(x.code),
        needsCapacity:!roomCodes.has(x.code)&&x.capacity===null,
        needsType:!roomCodes.has(x.code)&&x.type===null}))};
  });
  app.post('/api/v1/raiyat-resources/commit',{bodyLimit:30*1024*1024},async req=>{
    requireEditor(req);
    const roomDecision=z.object({
      capacity:z.number().int().min(1).max(1000),
      type:z.enum(['CLASSROOM','LAB','MULTI'])
    }).strict();
    const input=z.object({
      departmentId:uuid,collegeId:uuid,
      name:z.string().trim().min(1).max(240),
      base64:z.string().min(1).max(28_000_000),
      sha256:z.string().regex(/^[a-f0-9]{64}$/),
      acceptUnscoped:z.boolean().default(false),
      importRooms:z.boolean().default(false),
      skipIncompleteRooms:z.boolean().default(false),
      roomDecisions:z.record(z.string().min(1).max(60),roomDecision).default({})
    }).strict().parse(req.body);
    const kind=mime(input.name);if(!kind)throw fail('Only CSV and XLSX inputs are permitted',415);
    if(input.importRooms&&!mayImportRooms(req))throw fail('Importing shared college rooms requires college administration permission',403);
    const scope=await getScope(req,input.departmentId,input.collegeId);
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))
      throw fail('Invalid upload encoding',400);
    const bytes=Buffer.from(input.base64,'base64');
    if(bytes.length>20*1024*1024)throw fail('File too large',413);
    const actual=createHash('sha256').update(bytes).digest('hex');
    if(actual!==input.sha256)throw fail('File changed after preview',409);
    const parsed=await discover(bytes,kind,scope);
    if(parsed.unscoped&&!input.acceptUnscoped)
      throw fail('Workbook has no verified college/department columns in some rows; confirm the scope explicitly',409);
    const client=await pool.connect();
    let importedInstructors=0,existingInstructors=0,importedRooms=0,existingRooms=0,unresolvedRooms=0;
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
        [input.collegeId,input.departmentId]);
      for(const item of parsed.instructors){
        const exists=await client.query('SELECT 1 FROM instructors WHERE department_id=$1 AND code=$2',
          [input.departmentId,item.code]);
        if(exists.rowCount){existingInstructors++;continue;}
        // Timetable assignment is NOT a certification of future eligibility.
        // [] means no approved courses, not NULL (unrestricted eligibility).
        const inserted=await client.query(
          'INSERT INTO instructors(department_id,code,name,max_load,allowed_modes,eligible_course_codes,available,overload) '+
          'VALUES($1,$2,$3,$4,\'["ONSITE"]\'::jsonb,\'[]\'::jsonb,NULL,NULL) '+
          'ON CONFLICT(department_id,code) DO NOTHING RETURNING id',
          [input.departmentId,item.code,item.name,item.maxLoad??0]);
        if(inserted.rowCount)importedInstructors++;else existingInstructors++;
      }
      if(input.importRooms)for(const item of parsed.rooms){
        const exists=await client.query('SELECT 1 FROM rooms WHERE college_id=$1 AND code=$2',
          [input.collegeId,item.code]);
        if(exists.rowCount){existingRooms++;continue;}
        const choice=input.roomDecisions[item.code];
        const capacity=item.capacity??choice?.capacity??null;
        const type=item.type??choice?.type??null;
        if(!capacity||!type){
          if(input.skipIncompleteRooms){unresolvedRooms++;continue;}
          throw fail('Room '+item.code+' is missing verified capacity/type. Complete room decisions before saving.',409);
        }
        if(choice&&((item.capacity!==null&&choice.capacity!==item.capacity)||
          (item.type!==null&&choice.type!==item.type)))
          throw fail('Conflicting room decision for '+item.code,409);
        const inserted=await client.query(
          'INSERT INTO rooms(college_id,code,name,type,capacity,building,available) '+
          'VALUES($1,$2,$3,$4,$5,$6,NULL) '+
          'ON CONFLICT(college_id,code) DO NOTHING RETURNING id',
          [input.collegeId,item.code,item.name,type,capacity,item.building]);
        if(inserted.rowCount)importedRooms++;else existingRooms++;
      }
      await client.query(
        'INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) '+
        'VALUES($1,\'SMART_RAYAT_RESOURCE_IMPORT\',\'COLLEGE_RESOURCES\',$2,$3::jsonb)',
        [req.principal!.id,input.collegeId,JSON.stringify({
          sourceSha256:actual,importedInstructors,existingInstructors,importedRooms,existingRooms,
          unresolvedRooms,sheetCount:parsed.sheets.length,unscopedConfirmed:input.acceptUnscoped,
          note:'Historical timetable does not constitute course qualification or future availability'
        })]);
      await client.query('COMMIT');
      return {status:'COMMITTED',importedInstructors,existingInstructors,
        importedRooms,existingRooms,unresolvedRooms,warnings:parsed.warnings,
        eligibilityPending:importedInstructors};
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  });
}
