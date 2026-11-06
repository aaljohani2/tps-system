import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {eq} from 'drizzle-orm';
import {db,pool,institutions,colleges,departments,terms,courses,instructors,rooms} from './database.js';
import {audit,allowedCollege,allowedDepartment,requireEditor} from './security.js';
import {importCurriculumCsv} from '../importer.js';
import {importCatalogXlsx} from '../xlsx-import.js';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const uuid=z.string().uuid();
const name=z.string().trim().min(1).max(240);
const code=z.string().trim().min(1).max(60);
const mode=z.enum(['ONSITE','REMOTE','SELF_PACED','HYBRID']);
const windows=z.array(z.object({day:z.enum(['SUN','MON','TUE','WED','THU']),
  from:z.number().int().min(0).max(23),to:z.number().int().min(1).max(24)})
  .refine(w=>w.to>w.from && (w.day!=='THU'||w.to<=10),'Invalid availability time')).max(30).optional();
const courseBase=z.object({
 departmentId:uuid,code,title:name,level:z.number().int().min(1).max(12),theoryHours:z.number().int().min(0),
 practicalHours:z.number().int().min(0),demand:z.number().int().min(0),mode:mode.default('ONSITE'),
 eligibleModes:z.array(mode).default(['ONSITE']),blocks:z.array(z.string().min(1)).default([]),
 assignedInstructorId:z.string().optional(),exclusiveInstructor:z.boolean().default(false),
 hybridSplit:z.object({theoryOnsiteHours:z.number().int().nonnegative(),theoryRemoteHours:z.number().int().nonnegative(),
 practicalOnsiteHours:z.number().int().nonnegative(),practicalRemoteHours:z.number().int().nonnegative()}).optional()
});
const course=courseBase.refine(v=>v.theoryHours+v.practicalHours>0,{message:'Contact hours required'});
const instructor=z.object({departmentId:uuid,code,name,maxLoad:z.number().nonnegative(),
 allowedModes:z.array(mode).default(['ONSITE']),eligibleCourseCodes:z.array(z.string()).optional(),available:windows,
 overload:z.object({additionalHours:z.number().positive(),reason:name}).optional()});
const room=z.object({collegeId:uuid,code,name,type:z.enum(['CLASSROOM','LAB','MULTI']),
 capacity:z.number().int().positive(),building:z.string().max(240).optional(),available:windows});
function query(req:FastifyRequest,key:string):string|undefined{
  const input=req.query as Record<string,unknown>;
  return typeof input[key]==='string'?input[key] as string:undefined;
}
function parse<T extends z.ZodTypeAny>(schema:T,body:unknown):z.infer<T>{
  const result=schema.safeParse(body);
  if(!result.success)throw Object.assign(new Error('Invalid input'),{statusCode:400,details:result.error.flatten()});
  return result.data;
}
function forbidden(){throw Object.assign(new Error('Scope denied'),{statusCode:403});}
async function assertDepartment(req:FastifyRequest,departmentId:string){if(!await allowedDepartment(req.principal!,departmentId))forbidden();}
async function assertCollege(req:FastifyRequest,collegeId:string){if(!await allowedCollege(req.principal!,collegeId))forbidden();}
export async function registerCatalog(app:FastifyInstance){
  app.get('/api/v1/institutions',async(req)=>{
    const p=req.principal!;
    if(p.role==='SYSTEM_ADMIN')return db.select().from(institutions);
    return pool.query('SELECT DISTINCT i.* FROM institutions i JOIN colleges c ON c.institution_id=i.id WHERE c.id=$1',[p.collegeId])
      .then(r=>r.rows);
  });
  app.post('/api/v1/institutions',async(req)=>{
    requireEditor(req);if(req.principal!.role!=='SYSTEM_ADMIN')forbidden();
    const v=parse(z.object({name}),req.body);
    const rows=await db.insert(institutions).values(v).returning();await audit(req.principal!.id,'CREATE','INSTITUTION',rows[0]!.id);return rows[0];
  });
  app.get('/api/v1/colleges',async(req)=>{
    if(req.principal!.role==='SYSTEM_ADMIN')return db.select().from(colleges);
    return db.select().from(colleges).where(eq(colleges.id,req.principal!.collegeId!));
  });
  app.post('/api/v1/colleges',async(req)=>{
    requireEditor(req);if(req.principal!.role!=='SYSTEM_ADMIN')forbidden();
    const v=parse(z.object({institutionId:uuid,name}),req.body);
    const rows=await db.insert(colleges).values(v).returning();await audit(req.principal!.id,'CREATE','COLLEGE',rows[0]!.id);return rows[0];
  });
  app.get('/api/v1/departments',async(req)=>{
    const collegeId=query(req,'collegeId');
    const p=req.principal!;
    if(p.role==='SYSTEM_ADMIN'){
      if(collegeId)return db.select().from(departments).where(eq(departments.collegeId,uuid.parse(collegeId)));
      return db.select().from(departments);
    }
    const rows=await db.select().from(departments).where(eq(departments.collegeId,p.collegeId!));
    return p.departmentId?rows.filter(x=>x.id===p.departmentId):rows;
  });
  app.post('/api/v1/departments',async(req)=>{
    requireEditor(req);const v=parse(z.object({collegeId:uuid,name}),req.body);
    await assertCollege(req,v.collegeId);
    const rows=await db.insert(departments).values(v).returning();await audit(req.principal!.id,'CREATE','DEPARTMENT',rows[0]!.id);return rows[0];
  });
  app.get('/api/v1/terms',async(req)=>{
    const collegeId=uuid.parse(query(req,'collegeId'));
    await assertCollege(req,collegeId);
    return db.select().from(terms).where(eq(terms.collegeId,collegeId));
  });
  app.post('/api/v1/terms',async(req)=>{
    requireEditor(req);const v=parse(z.object({collegeId:uuid,code,label:name,
      startsOn:z.string().regex(/^\d{4}-\d\d-\d\d$/),endsOn:z.string().regex(/^\d{4}-\d\d-\d\d$/)}),req.body);
    await assertCollege(req,v.collegeId);
    const rows=await db.insert(terms).values(v).returning();await audit(req.principal!.id,'CREATE','TERM',rows[0]!.id);return rows[0];
  });
  app.get('/api/v1/courses',async(req)=>{
    const departmentId=uuid.parse(query(req,'departmentId'));await assertDepartment(req,departmentId);
    return db.select().from(courses).where(eq(courses.departmentId,departmentId));
  });
  app.post('/api/v1/courses',async(req)=>{
    requireEditor(req);const v=parse(course,req.body);await assertDepartment(req,v.departmentId);
    const rows=await db.insert(courses).values({...v,hybridSplit:v.hybridSplit??null,assignedInstructorId:v.assignedInstructorId??null}).returning();
    await audit(req.principal!.id,'CREATE','COURSE',rows[0]!.id);return rows[0];
  });
  app.patch('/api/v1/courses/:id',async(req)=>{
    requireEditor(req);const id=uuid.parse((req.params as {id:string}).id);
    const old=await pool.query<{department_id:string}>('SELECT department_id FROM courses WHERE id=$1',[id]);
    if(!old.rows[0])throw Object.assign(new Error('Not found'),{statusCode:404});
    await assertDepartment(req,old.rows[0].department_id);
    const v=parse(courseBase.omit({departmentId:true}).partial(),req.body);
    const rows=await db.update(courses).set(v).where(eq(courses.id,id)).returning();
    await audit(req.principal!.id,'UPDATE','COURSE',id);return rows[0];
  });
  app.get('/api/v1/instructors',async(req)=>{
    const departmentId=uuid.parse(query(req,'departmentId'));await assertDepartment(req,departmentId);
    return db.select().from(instructors).where(eq(instructors.departmentId,departmentId));
  });
  app.post('/api/v1/instructors',async(req)=>{
    requireEditor(req);const v=parse(instructor,req.body);await assertDepartment(req,v.departmentId);
    const rows=await db.insert(instructors).values({...v,maxLoad:String(v.maxLoad),eligibleCourseCodes:v.eligibleCourseCodes??null,available:v.available??null,overload:v.overload??null}).returning();
    await audit(req.principal!.id,'CREATE','INSTRUCTOR',rows[0]!.id);return rows[0];
  });
  app.patch('/api/v1/instructors/:id',async(req)=>{
    requireEditor(req);
    const id=uuid.parse((req.params as {id:string}).id);
    const found=await pool.query<{department_id:string}>('SELECT department_id FROM instructors WHERE id=$1',[id]);
    if(!found.rows[0])throw Object.assign(new Error('Instructor not found'),{statusCode:404});
    await assertDepartment(req,found.rows[0].department_id);
    const v=parse(instructor.omit({departmentId:true}).partial().strict(),req.body);
    if(!Object.keys(v).length)throw Object.assign(new Error('No changes supplied'),{statusCode:400});
    const values={...v,maxLoad:v.maxLoad===undefined?undefined:String(v.maxLoad)};
    const updated=await db.update(instructors).set(values).where(eq(instructors.id,id)).returning();
    await audit(req.principal!.id,'UPDATE','INSTRUCTOR',id,{fields:Object.keys(v)});
    return updated[0];
  });
  app.get('/api/v1/rooms',async(req)=>{
    const collegeId=uuid.parse(query(req,'collegeId'));await assertCollege(req,collegeId);
    return db.select().from(rooms).where(eq(rooms.collegeId,collegeId));
  });
  app.post('/api/v1/rooms',async(req)=>{
    requireEditor(req);
    if(req.principal!.departmentId && req.principal!.role!=='SYSTEM_ADMIN')forbidden();
    const v=parse(room,req.body);await assertCollege(req,v.collegeId);
    const rows=await db.insert(rooms).values({...v,available:v.available??null,building:v.building??null}).returning();
    await audit(req.principal!.id,'CREATE','ROOM',rows[0]!.id);return rows[0];
  });
  app.patch('/api/v1/rooms/:id',async(req)=>{
    requireEditor(req);
    // Rooms are shared college-wide. A department-only account cannot mutate their master records.
    if(req.principal!.departmentId && req.principal!.role!=='SYSTEM_ADMIN')forbidden();
    const id=uuid.parse((req.params as {id:string}).id);
    const found=await pool.query<{college_id:string}>('SELECT college_id FROM rooms WHERE id=$1',[id]);
    if(!found.rows[0])throw Object.assign(new Error('Room not found'),{statusCode:404});
    await assertCollege(req,found.rows[0].college_id);
    const v=parse(room.omit({collegeId:true}).partial().strict(),req.body);
    if(!Object.keys(v).length)throw Object.assign(new Error('No changes supplied'),{statusCode:400});
    const updated=await db.update(rooms).set(v).where(eq(rooms.id,id)).returning();
    await audit(req.principal!.id,'UPDATE','ROOM',id,{fields:Object.keys(v)});
    return updated[0];
  });
  app.post('/api/v1/import/courses/preview',async(req)=>{
    requireEditor(req);
    const v=parse(z.object({departmentId:uuid,csv:z.string().max(3000000)}),req.body);
    await assertDepartment(req,v.departmentId);
    return importCurriculumCsv(v.csv);
  });
  app.post('/api/v1/import/courses/commit',async(req)=>{
    requireEditor(req);const v=parse(z.object({departmentId:uuid,csv:z.string().max(3000000)}),req.body);
    await assertDepartment(req,v.departmentId);
    const preview=importCurriculumCsv(v.csv);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      for(const c of preview.courses){
        await client.query(`INSERT INTO courses(department_id,code,title,level,theory_hours,practical_hours,demand,mode,eligible_modes)
          VALUES($1,$2,$3,$4,$5,$6,0,'ONSITE','["ONSITE"]')
          ON CONFLICT(department_id,code) DO UPDATE SET title=EXCLUDED.title,level=EXCLUDED.level,
          theory_hours=EXCLUDED.theory_hours,practical_hours=EXCLUDED.practical_hours,updated_at=now()`,
          [v.departmentId,c.code,c.title,c.level,c.theoryHours,c.practicalHours]);
      }
      await client.query('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',
        [req.principal!.id,'IMPORT','COURSES',v.departmentId,JSON.stringify({count:preview.courses.length})]);
      await client.query('COMMIT');
      return {imported:preview.courses.length,ignored:preview.ignored,warnings:preview.warnings};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });
  app.get('/api/v1/import/courses/template.csv',async(_req,reply)=>{
    reply.header('content-type','text/csv; charset=utf-8');
    reply.header('content-disposition','attachment; filename="tps-courses.csv"');
    return '\uFEFF'+'المقرر,اسم المقرر,الفصل التدريبي,مح,عم,تم,س\r\n';
  });
  app.get('/api/v1/import/courses/template.xlsx',async(_req,reply)=>{
    const bytes=await readFile(resolve('web/templates/TPS_Course_Demand_144720.xlsx'));
    reply.header('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition','attachment; filename="tps-courses-template.xlsx"');
    return reply.send(bytes);
  });
  app.post('/api/v1/import/courses/preview-xlsx',async(req)=>{
    requireEditor(req);
    const departmentId=uuid.parse(query(req,'departmentId'));
    await assertDepartment(req,departmentId);
    return importCatalogXlsx(req.body as Buffer);
  });
  app.post('/api/v1/import/courses/commit-xlsx',async(req)=>{
    requireEditor(req);
    const departmentId=uuid.parse(query(req,'departmentId'));
    await assertDepartment(req,departmentId);
    const preview=await importCatalogXlsx(req.body as Buffer);
    const client=await pool.connect();
    const statement='INSERT INTO courses(department_id,code,title,level,theory_hours,practical_hours,demand,mode,eligible_modes) '+
      'VALUES($1,$2,$3,$4,$5,$6,0,\'ONSITE\',\'["ONSITE"]\') '+
      'ON CONFLICT(department_id,code) DO UPDATE SET title=EXCLUDED.title,level=EXCLUDED.level, '+
      'theory_hours=EXCLUDED.theory_hours,practical_hours=EXCLUDED.practical_hours,updated_at=now()';
    try{
      await client.query('BEGIN');
      for(const c of preview.courses){
        await client.query(statement,[departmentId,c.code,c.title,c.level,c.theoryHours,c.practicalHours]);
      }
      await client.query('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',
        [req.principal!.id,'IMPORT_XLSX','COURSES',departmentId,JSON.stringify({count:preview.courses.length})]);
      await client.query('COMMIT');
      return {imported:preview.courses.length,ignored:preview.ignored,warnings:preview.warnings};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });

}
