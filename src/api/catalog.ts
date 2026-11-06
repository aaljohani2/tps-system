import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {and,eq} from 'drizzle-orm';
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
const codes=z.array(z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/)).max(30)
  .refine(v=>new Set(v).size===v.length,'Duplicate qualification/equipment codes');
const windows=z.array(z.object({day:z.enum(['SUN','MON','TUE','WED','THU']),
  from:z.number().multipleOf(0.5).min(0).max(23.5),to:z.number().multipleOf(0.5).min(0.5).max(24)})
  .refine(w=>w.to>w.from && (w.day!=='THU'||w.to<=10),'Invalid availability time')).max(30).optional();
const courseBase=z.object({
 departmentId:uuid,code,title:name,level:z.number().int().min(1).max(12),theoryHours:z.number().int().min(0),
 practicalHours:z.number().int().min(0),demand:z.number().int().min(0),mode:mode.default('ONSITE'),
 eligibleModes:z.array(mode).default(['ONSITE']),requiredSpecialties:codes.default([]),
 requiredEquipment:codes.default([]),blocks:z.array(z.string().min(1)).default([]),
 assignedInstructorId:z.string().optional(),exclusiveInstructor:z.boolean().default(false),
 hybridSplit:z.object({theoryOnsiteHours:z.number().int().nonnegative(),theoryRemoteHours:z.number().int().nonnegative(),
 practicalOnsiteHours:z.number().int().nonnegative(),practicalRemoteHours:z.number().int().nonnegative()}).optional()
});
const course=courseBase.refine(v=>v.theoryHours+v.practicalHours>0,{message:'Contact hours required'});
const instructor=z.object({departmentId:uuid,code,name,maxLoad:z.number().nonnegative(),
 allowedModes:z.array(mode).default(['ONSITE']),eligibleCourseCodes:z.array(z.string()).optional(),
 specialties:codes.default([]),available:windows,
 overload:z.object({additionalHours:z.number().positive(),reason:name}).optional()});
const room=z.object({collegeId:uuid,code,name,type:z.enum(['CLASSROOM','LAB','MULTI']),
 capacity:z.number().int().positive(),equipmentCodes:codes.default([]),building:z.string().max(240).optional(),available:windows});
function query(req:FastifyRequest,key:string):string|undefined{
  const input=req.query as Record<string,unknown>;
  return typeof input[key]==='string'?input[key] as string:undefined;
}
function parse<T extends z.ZodTypeAny>(schema:T,body:unknown):z.infer<T>{
  const result=schema.safeParse(body);
  if(!result.success)throw Object.assign(new Error('Invalid input'),{statusCode:400,details:result.error.flatten()});
  return result.data;
}
// In Zod v4 a .partial() can materialize inner defaults. PATCH changes
// exclusively the properties explicitly supplied by the client.
function suppliedOnly<T extends Record<string,unknown>>(parsed:T,body:unknown):T{
  const source=body as Record<string,unknown>;
  return Object.fromEntries(Object.entries(parsed).filter(([key])=>
    Object.prototype.hasOwnProperty.call(source,key))) as T;
}
function forbidden(){throw Object.assign(new Error('Scope denied'),{statusCode:403});}
async function assertDepartment(req:FastifyRequest,departmentId:string){if(!await allowedDepartment(req.principal!,departmentId))forbidden();}
async function assertCollege(req:FastifyRequest,collegeId:string){if(!await allowedCollege(req.principal!,collegeId))forbidden();}
function requireCollegeEditor(req:FastifyRequest){
  requireEditor(req);
  if(req.principal!.departmentId&&req.principal!.role!=='SYSTEM_ADMIN')forbidden();
}
async function assertLockedTrainerQualified(departmentId:string,courseCode:string,
  deliveryMode:string,requiredSpecialties:string[],trainerCode:string|null|undefined){
  if(!trainerCode)return;
  const trainer=await pool.query<{allowed_modes:string[];eligible_course_codes:string[]|null;specialties:string[]}>(`
    SELECT allowed_modes,eligible_course_codes,specialties FROM instructors
    WHERE department_id=$1 AND code=$2 AND is_active=true`,[departmentId,trainerCode]);
  const found=trainer.rows[0];
  if(!found)throw Object.assign(new Error('Assigned instructor not found in department'),{statusCode:409});
  if(!found.allowed_modes.includes(deliveryMode) ||
    (deliveryMode==='HYBRID'&&(!found.allowed_modes.includes('ONSITE')||!found.allowed_modes.includes('REMOTE'))) ||
    (found.eligible_course_codes&&!found.eligible_course_codes.includes(courseCode)) ||
    requiredSpecialties.some(x=>!found.specialties.includes(x)))
    throw Object.assign(new Error('Assigned instructor does not meet course mode, eligibility or specialty requirements'),{statusCode:409});
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
    return db.select().from(courses).where(query(req,'includeArchived')==='true'?
      eq(courses.departmentId,departmentId):and(eq(courses.departmentId,departmentId),eq(courses.active,true)));
  });
  app.post('/api/v1/courses',async(req)=>{
    requireEditor(req);const v=parse(course,req.body);await assertDepartment(req,v.departmentId);
    await assertLockedTrainerQualified(v.departmentId,v.code,v.mode,v.requiredSpecialties,v.assignedInstructorId);
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
    const v=suppliedOnly(parse(courseBase.omit({departmentId:true,eligibleModes:true}).partial().extend({
      assignedInstructorId:z.string().trim().min(1).max(60).nullable().optional(),
      hybridSplit:courseBase.shape.hybridSplit.nullable().optional()
    }).strict(),req.body),req.body);
    if(!Object.keys(v).length)throw Object.assign(new Error('No changes supplied'),{statusCode:400});
    if(v.mode && !old.rows[0].eligible_modes.includes(v.mode))
      throw Object.assign(new Error('Delivery mode is not approved for this course'),{statusCode:409});
    const currentLocked=await pool.query<{code:string;mode:string;assigned_instructor_id:string|null;required_specialties:string[]}>(`
      SELECT code,mode,assigned_instructor_id,required_specialties FROM courses WHERE id=$1`,[id]);
    const existingLock=currentLocked.rows[0]!;
    await assertLockedTrainerQualified(old.rows[0].department_id,existingLock.code,
      v.mode??existingLock.mode,v.requiredSpecialties??existingLock.required_specialties,
      v.assignedInstructorId===undefined?existingLock.assigned_instructor_id:v.assignedInstructorId);
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
    return db.select().from(instructors).where(query(req,'includeArchived')==='true'?
      eq(instructors.departmentId,departmentId):and(eq(instructors.departmentId,departmentId),eq(instructors.active,true)));
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
    const v=suppliedOnly(parse(instructor.omit({departmentId:true,overload:true}).partial().extend({
      eligibleCourseCodes:z.array(z.string()).nullable().optional(),
      available:windows.nullable()
    }).strict(),req.body),req.body);
    if(!Object.keys(v).length)throw Object.assign(new Error('No changes supplied'),{statusCode:400});
    const values={...v,maxLoad:v.maxLoad===undefined?undefined:String(v.maxLoad)};
    const updated=await db.update(instructors).set(values).where(eq(instructors.id,id)).returning();
    await audit(req.principal!.id,'UPDATE','INSTRUCTOR',id,{fields:Object.keys(v)});
    return updated[0];
  });
  app.get('/api/v1/rooms',async(req)=>{
    const collegeId=uuid.parse(query(req,'collegeId'));await assertCollege(req,collegeId);
    return db.select().from(rooms).where(query(req,'includeArchived')==='true'?
      eq(rooms.collegeId,collegeId):and(eq(rooms.collegeId,collegeId),eq(rooms.active,true)));
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
    const v=suppliedOnly(parse(room.omit({collegeId:true}).partial().extend({available:windows.nullable()}).strict(),req.body),req.body);
    if(!Object.keys(v).length)throw Object.assign(new Error('No changes supplied'),{statusCode:400});
    const updated=await db.update(rooms).set(v).where(eq(rooms.id,id)).returning();
    await audit(req.principal!.id,'UPDATE','ROOM',id,{fields:Object.keys(v)});
    return updated[0];
  });

  // Reversible lifecycle operations. Read scope and prior state, update and
  // insert the audit event in the SAME transaction to avoid an unaudited
  // archive or restore if any part of the operation fails.
  const lifecycle=z.object({active:z.boolean(),reason:z.string().trim().min(8).max(1000)}).strict();
  async function resourceLifecycle(req:FastifyRequest,kind:'courses'|'instructors'|'rooms'){
    if(kind==='rooms')requireCollegeEditor(req);else requireEditor(req);
    const id=uuid.parse((req.params as {id:string}).id),v=parse(lifecycle,req.body);
    const entity=kind==='courses'?'COURSE':kind==='rooms'?'ROOM':'INSTRUCTOR';
    const scopeField=kind==='rooms'?'college_id':'department_id';
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      // kind and scopeField are internal fixed enums; never user-provided SQL.
      const prior=await client.query<{scope_id:string;is_active:boolean}>(`
        SELECT ${scopeField} AS scope_id,is_active FROM ${kind} WHERE id=$1 FOR UPDATE`,[id]);
      if(!prior.rows[0])throw Object.assign(new Error('Resource not found'),{statusCode:404});
      if(kind==='rooms')await assertCollege(req,prior.rows[0].scope_id);
      else await assertDepartment(req,prior.rows[0].scope_id);
      if(prior.rows[0].is_active===v.active)
        throw Object.assign(new Error('Resource already has this lifecycle state'),{statusCode:409});
      if(kind==='courses'&&!v.active){
        const activePlan=await client.query(`SELECT ci.plan_id FROM curriculum_items ci
          JOIN curriculum_plans cp ON cp.id=ci.plan_id
          WHERE ci.course_id=$1 AND cp.state='ACTIVE' LIMIT 1`,[id]);
        if(activePlan.rowCount)
          throw Object.assign(new Error('Course belongs to an ACTIVE curriculum plan; revise the plan before archiving'),{statusCode:409});
      }
      const updated=await client.query<{id:string;is_active:boolean}>(`
        UPDATE ${kind} SET is_active=$2,updated_at=now() WHERE id=$1 RETURNING id,is_active`,[id,v.active]);
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,$2,$3,$4,$5::jsonb)`,[
          req.principal!.id,(v.active?'RESTORE_':'ARCHIVE_')+entity,entity,id,
          JSON.stringify({reason:v.reason})
        ]);
      await client.query('COMMIT');
      return updated.rows[0];
    }catch(e){await client.query('ROLLBACK');throw e;}
    finally{client.release();}
  }
  app.patch('/api/v1/courses/:id/lifecycle',req=>resourceLifecycle(req,'courses'));
  app.patch('/api/v1/instructors/:id/lifecycle',req=>resourceLifecycle(req,'instructors'));
  app.patch('/api/v1/rooms/:id/lifecycle',req=>resourceLifecycle(req,'rooms'));
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
