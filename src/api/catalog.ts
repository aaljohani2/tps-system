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
  from:z.number().multipleOf(0.5).min(0).max(23.5),to:z.number().multipleOf(0.5).min(0.5).max(24)})
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
function requireCollegeEditor(req:FastifyRequest){
  requireEditor(req);
  if(req.principal!.departmentId&&req.principal!.role!=='SYSTEM_ADMIN')forbidden();
}
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
    requireCollegeEditor(req);const v=parse(z.object({collegeId:uuid,name}),req.body);
    await assertCollege(req,v.collegeId);
    const rows=await db.insert(departments).values(v).returning();await audit(req.principal!.id,'CREATE','DEPARTMENT',rows[0]!.id);return rows[0];
  });
  app.get('/api/v1/terms',async(req)=>{
    const collegeId=uuid.parse(query(req,'collegeId'));
    await assertCollege(req,collegeId);
    return db.select().from(terms).where(eq(terms.collegeId,collegeId));
  });
  app.post('/api/v1/terms',async(req)=>{
    requireCollegeEditor(req);const v=parse(z.object({collegeId:uuid,code,label:name,
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
    const old=await pool.query<{department_id:string;eligible_modes:string[];mode:string}>(
      'SELECT department_id,eligible_modes,mode FROM courses WHERE id=$1',[id]);
    if(!old.rows[0])throw Object.assign(new Error('Not found'),{statusCode:404});
    await assertDepartment(req,old.rows[0].department_id);
    // Eligibility cannot be granted by a normal course edit, including the UI mode selector.
    const v=parse(courseBase.omit({departmentId:true,eligibleModes:true}).partial().extend({
      assignedInstructorId:z.string().trim().min(1).max(60).nullable().optional(),
      hybridSplit:courseBase.shape.hybridSplit.nullable().optional()
    }).strict(),req.body);
    if(!Object.keys(v).length)throw Object.assign(new Error('No changes supplied'),{statusCode:400});
    if(v.mode && !old.rows[0].eligible_modes.includes(v.mode))
      throw Object.assign(new Error('Delivery mode is not approved for this course'),{statusCode:409});
    if(v.assignedInstructorId){
      const inst=await pool.query<{allowed_modes:string[];eligible_course_codes:string[]|null}>(
        'SELECT allowed_modes,eligible_course_codes FROM instructors WHERE department_id=$1 AND code=$2',
        [old.rows[0].department_id,v.assignedInstructorId]);
      if(!inst.rows[0])throw Object.assign(new Error('Assigned instructor not found in department'),{statusCode:409});
      const current=await pool.query<{code:string;mode:string}>('SELECT code,mode FROM courses WHERE id=$1',[id]);
      const needed=v.mode??current.rows[0]!.mode;
      if(!inst.rows[0].allowed_modes.includes(needed) ||
        (inst.rows[0].eligible_course_codes && !inst.rows[0].eligible_course_codes.includes(current.rows[0]!.code)))
        throw Object.assign(new Error('Instructor is not eligible for requested course/mode'),{statusCode:409});
    }
    const existing=await pool.query<{mode:string;theory_hours:number;practical_hours:number;hybrid_split:unknown}>(
      'SELECT mode,theory_hours,practical_hours,hybrid_split FROM courses WHERE id=$1',[id]);
    const effectiveMode=v.mode??existing.rows[0]!.mode;
    const split=v.hybridSplit===undefined?existing.rows[0]!.hybrid_split:v.hybridSplit;
    const theory=v.theoryHours??existing.rows[0]!.theory_hours,practical=v.practicalHours??existing.rows[0]!.practical_hours;
    if(effectiveMode==='HYBRID'){
      if(!split || typeof split!=='object')throw Object.assign(new Error('HYBRID requires a timed onsite/remote split'),{statusCode:409});
      const h=split as {theoryOnsiteHours:number;theoryRemoteHours:number;practicalOnsiteHours:number;practicalRemoteHours:number};
      if(h.theoryOnsiteHours+h.theoryRemoteHours!==theory ||
        h.practicalOnsiteHours+h.practicalRemoteHours!==practical ||
        h.theoryOnsiteHours+h.practicalOnsiteHours===0 ||
        h.theoryRemoteHours+h.practicalRemoteHours===0)
        throw Object.assign(new Error('Hybrid component hours must match totals and include both onsite and remote'),{statusCode:409});
    }
    if(effectiveMode!=='HYBRID' && split && v.hybridSplit!==null)
      throw Object.assign(new Error('Non-hybrid delivery cannot retain a hybrid split'),{statusCode:409});
    const rows=await db.update(courses).set(v).where(eq(courses.id,id)).returning();
    await audit(req.principal!.id,'UPDATE','COURSE',id);return rows[0];
  });
  app.put('/api/v1/courses/:id/eligibility',async(req)=>{
    // Approval of course-level delivery eligibility is separate from changing the course mode.
    // This is an INTERNAL planning approval, not a claimed institutional/regulatory authorization.
    requireEditor(req);
    if(!['SYSTEM_ADMIN','COLLEGE_ADMIN'].includes(req.principal!.role))forbidden();
    const id=uuid.parse((req.params as {id:string}).id);
    const v=parse(z.object({
      eligibleModes:z.array(mode).min(1).max(4).refine(a=>new Set(a).size===a.length,'Duplicate modes'),
      reason:z.string().trim().min(8).max(1200)
    }).strict(),req.body);
    const old=await pool.query<{department_id:string;mode:string}>(
      'SELECT department_id,mode FROM courses WHERE id=$1',[id]);
    if(!old.rows[0])throw Object.assign(new Error('Course not found'),{statusCode:404});
    await assertDepartment(req,old.rows[0].department_id);
    const currentMode=old.rows[0].mode;
    if(!v.eligibleModes.some(value=>value===currentMode))
      throw Object.assign(new Error('The current course delivery mode must remain eligible'),{statusCode:409});
    const changed=await pool.query('UPDATE courses SET eligible_modes=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING id,code,eligible_modes',[id,JSON.stringify(v.eligibleModes)]);
    await audit(req.principal!.id,'APPROVE_COURSE_MODES','COURSE',id,{eligibleModes:v.eligibleModes,reason:v.reason});
    return changed.rows[0];
  });
  app.get('/api/v1/instructors',async(req)=>{
    const departmentId=uuid.parse(query(req,'departmentId'));await assertDepartment(req,departmentId);
    return db.select().from(instructors).where(eq(instructors.departmentId,departmentId));
  });
  app.post('/api/v1/instructors',async(req)=>{
    requireEditor(req);const v=parse(instructor.omit({overload:true}).strict(),req.body);await assertDepartment(req,v.departmentId);
    const rows=await db.insert(instructors).values({...v,maxLoad:String(v.maxLoad),eligibleCourseCodes:v.eligibleCourseCodes??null,available:v.available??null,overload:null}).returning();
    await audit(req.principal!.id,'CREATE','INSTRUCTOR',rows[0]!.id);return rows[0];
  });
  app.patch('/api/v1/instructors/:id',async(req)=>{
    requireEditor(req);
    const id=uuid.parse((req.params as {id:string}).id);
    const found=await pool.query<{department_id:string}>('SELECT department_id FROM instructors WHERE id=$1',[id]);
    if(!found.rows[0])throw Object.assign(new Error('Instructor not found'),{statusCode:404});
    await assertDepartment(req,found.rows[0].department_id);
    const v=parse(instructor.omit({departmentId:true,overload:true}).partial().extend({
      eligibleCourseCodes:z.array(z.string()).nullable().optional(),
      available:windows.nullable()
    }).strict(),req.body);
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
    requireCollegeEditor(req);
    const v=parse(room,req.body);await assertCollege(req,v.collegeId);
    const rows=await db.insert(rooms).values({...v,available:v.available??null,building:v.building??null}).returning();
    await audit(req.principal!.id,'CREATE','ROOM',rows[0]!.id);return rows[0];
  });
  app.patch('/api/v1/rooms/:id',async(req)=>{
    requireCollegeEditor(req);
    // Rooms are shared college-wide. Department-scoped accounts cannot mutate master records.
    const id=uuid.parse((req.params as {id:string}).id);
    const found=await pool.query<{college_id:string}>('SELECT college_id FROM rooms WHERE id=$1',[id]);
    if(!found.rows[0])throw Object.assign(new Error('Room not found'),{statusCode:404});
    await assertCollege(req,found.rows[0].college_id);
    const v=parse(room.omit({collegeId:true}).partial().extend({available:windows.nullable()}).strict(),req.body);
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
    requireEditor(req);
    throw Object.assign(new Error('Legacy direct import is disabled. Use /import/batch/courses/preview and commit with the exact reviewed file.'),{statusCode:410});
  });
  app.get('/api/v1/import/courses/template.csv',async(_req,reply)=>{
    return reply.redirect('/api/v1/import/batch/courses/template.csv',308);
  });
  app.get('/api/v1/import/courses/template.xlsx',async(_req,reply)=>{
    return reply.redirect('/api/v1/import/batch/courses/template.xlsx',308);
  });
  app.post('/api/v1/import/courses/preview-xlsx',async(req)=>{
    requireEditor(req);
    const departmentId=uuid.parse(query(req,'departmentId'));
    await assertDepartment(req,departmentId);
    return importCatalogXlsx(req.body as Buffer);
  });
  app.post('/api/v1/import/courses/commit-xlsx',async(req)=>{
    requireEditor(req);
    throw Object.assign(new Error('Legacy direct XLSX import is disabled. Use the reviewed /import/batch/courses workflow.'),{statusCode:410});
  });

}
