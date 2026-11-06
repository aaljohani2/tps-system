import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {pool} from './database.js';
import {audit,allowedDepartment,canEdit,requireEditor} from './security.js';

const uid=z.string().uuid();
const label=z.string().trim().min(1).max(200);
const code=z.string().trim().min(1).max(60).regex(/^[^\s:/]+$/,'Code must not contain whitespace, colon or slash');
const level=z.number().int().min(1).max(12);
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
function values(req:FastifyRequest){return req.query as Record<string,unknown>;}
function idParam(req:FastifyRequest){return uid.parse((req.params as {id:string}).id);}
async function department(req:FastifyRequest,departmentId:string){
  if(!await allowedDepartment(req.principal!,departmentId))throw fail('Scope denied',403);
}
async function termCheck(departmentId:string,termId:string){
  const found=await pool.query('SELECT 1 FROM departments d JOIN academic_terms t ON t.college_id=d.college_id WHERE d.id=$1 AND t.id=$2',[departmentId,termId]);
  if(!found.rowCount)throw fail('Term is not in department college',400);
}
async function courseDepartment(courseId:string){
  const r=await pool.query<{department_id:string}>('SELECT department_id FROM courses WHERE id=$1',[courseId]);
  if(!r.rows[0])throw fail('Course not found',404);
  return r.rows[0].department_id;
}
async function programDepartment(programId:string){
  const r=await pool.query<{department_id:string}>('SELECT department_id FROM training_programs WHERE id=$1',[programId]);
  if(!r.rows[0])throw fail('Program not found',404);
  return r.rows[0].department_id;
}
async function blockScope(blockId:string){
  const r=await pool.query<{department_id:string;level:number}>(
    'SELECT c.department_id,c.level FROM student_blocks b JOIN cohorts c ON c.id=b.cohort_id WHERE b.id=$1',[blockId]);
  if(!r.rows[0])throw fail('Block not found',404);
  return r.rows[0];
}
export async function registerAcademic(app:FastifyInstance){
  app.get('/api/v1/programs',async(req)=>{
    const v=z.object({departmentId:uid}).parse(values(req));
    await department(req,v.departmentId);
    return (await pool.query('SELECT id,department_id,code,name,is_active FROM training_programs WHERE department_id=$1 ORDER BY code',[v.departmentId])).rows;
  });
  app.post('/api/v1/programs',async(req)=>{
    requireEditor(req);
    const v=z.object({departmentId:uid,code,name:label}).strict().parse(req.body);
    await department(req,v.departmentId);
    const r=await pool.query('INSERT INTO training_programs(department_id,code,name) VALUES($1,$2,$3) RETURNING *',[v.departmentId,v.code,v.name]);
    await audit(req.principal!.id,'CREATE','TRAINING_PROGRAM',r.rows[0].id);
    return r.rows[0];
  });
  app.get('/api/v1/plans',async(req)=>{
    const v=z.object({programId:uid}).parse(values(req));
    await department(req,await programDepartment(v.programId));
    return (await pool.query('SELECT * FROM curriculum_plans WHERE program_id=$1 ORDER BY code',[v.programId])).rows;
  });
  app.post('/api/v1/plans',async(req)=>{
    requireEditor(req);
    const v=z.object({programId:uid,code,versionLabel:label}).strict().parse(req.body);
    await department(req,await programDepartment(v.programId));
    const r=await pool.query('INSERT INTO curriculum_plans(program_id,code,version_label) VALUES($1,$2,$3) RETURNING *',[v.programId,v.code,v.versionLabel]);
    await audit(req.principal!.id,'CREATE','CURRICULUM_PLAN',r.rows[0].id);
    return r.rows[0];
  });
  app.get('/api/v1/plans/:id/items',async(req)=>{
    const id=idParam(req);
    const owner=await pool.query<{department_id:string}>(`SELECT p.department_id FROM curriculum_plans cp
      JOIN training_programs p ON p.id=cp.program_id WHERE cp.id=$1`,[id]);
    if(!owner.rows[0])throw fail('Plan not found',404);
    await department(req,owner.rows[0].department_id);
    return (await pool.query(`SELECT ci.id,ci.plan_id,ci.course_id,ci.level,ci.is_required,c.code,c.title
       FROM curriculum_items ci JOIN courses c ON c.id=ci.course_id WHERE ci.plan_id=$1 ORDER BY ci.level,c.code`,[id])).rows;
  });
  app.post('/api/v1/plans/:id/items',async(req)=>{
    requireEditor(req);
    const id=idParam(req),v=z.object({courseId:uid,level,isRequired:z.boolean().default(true)}).strict().parse(req.body);
    const owner=await pool.query<{department_id:string}>(`SELECT p.department_id FROM curriculum_plans cp
      JOIN training_programs p ON p.id=cp.program_id WHERE cp.id=$1`,[id]);
    if(!owner.rows[0])throw fail('Plan not found',404);
    await department(req,owner.rows[0].department_id);
    if(await courseDepartment(v.courseId)!==owner.rows[0].department_id)throw fail('Course and plan must belong to same department');
    const r=await pool.query(`INSERT INTO curriculum_items(plan_id,course_id,level,is_required)
       VALUES($1,$2,$3,$4) ON CONFLICT(plan_id,course_id) DO UPDATE SET
       level=EXCLUDED.level,is_required=EXCLUDED.is_required RETURNING *`,[id,v.courseId,v.level,v.isRequired]);
    await audit(req.principal!.id,'UPSERT','CURRICULUM_ITEM',r.rows[0].id,{planId:id});
    return r.rows[0];
  });
  app.get('/api/v1/cohorts',async(req)=>{
    const v=z.object({departmentId:uid}).parse(values(req));
    await department(req,v.departmentId);
    return (await pool.query(`SELECT c.*,p.code AS program_code FROM cohorts c LEFT JOIN training_programs p ON p.id=c.program_id
      WHERE c.department_id=$1 ORDER BY c.level,c.code`,[v.departmentId])).rows;
  });
  app.post('/api/v1/cohorts',async(req)=>{
    requireEditor(req);
    const v=z.object({departmentId:uid,programId:uid.nullable().optional(),code,name:label,level}).strict().parse(req.body);
    await department(req,v.departmentId);
    if(v.programId && await programDepartment(v.programId)!==v.departmentId)throw fail('Program does not belong to cohort department');
    const r=await pool.query(`INSERT INTO cohorts(department_id,program_id,code,name,level)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,[v.departmentId,v.programId??null,v.code,v.name,v.level]);
    await audit(req.principal!.id,'CREATE','COHORT',r.rows[0].id);
    return r.rows[0];
  });
  app.get('/api/v1/blocks',async(req)=>{
    const v=z.object({departmentId:uid}).parse(values(req));
    await department(req,v.departmentId);
    return (await pool.query(`SELECT b.id,b.cohort_id,b.code,b.name,b.size,c.code AS cohort_code,c.level
      FROM student_blocks b JOIN cohorts c ON c.id=b.cohort_id WHERE c.department_id=$1 ORDER BY c.code,b.code`,[v.departmentId])).rows;
  });
  app.post('/api/v1/blocks',async(req)=>{
    requireEditor(req);
    const v=z.object({cohortId:uid,code,name:label,size:z.number().int().min(1).max(5000)}).strict().parse(req.body);
    const owner=await pool.query<{department_id:string}>('SELECT department_id FROM cohorts WHERE id=$1',[v.cohortId]);
    if(!owner.rows[0])throw fail('Cohort not found',404);
    await department(req,owner.rows[0].department_id);
    const r=await pool.query('INSERT INTO student_blocks(cohort_id,code,name,size) VALUES($1,$2,$3,$4) RETURNING *',
      [v.cohortId,v.code,v.name,v.size]);
    await audit(req.principal!.id,'CREATE','STUDENT_BLOCK',r.rows[0].id);
    return r.rows[0];
  });
  app.patch('/api/v1/blocks/:id',async(req)=>{
    requireEditor(req);
    const id=idParam(req);
    const scope=await blockScope(id);
    await department(req,scope.department_id);
    const v=z.object({name:label.optional(),size:z.number().int().min(1).max(5000).optional()}).strict().parse(req.body);
    if(!Object.keys(v).length)throw fail('No changes supplied');
    // Changes to block sizes affect only newly created scenario snapshots, never approved results.
    const r=await pool.query(`UPDATE student_blocks SET name=COALESCE($2,name),size=COALESCE($3,size)
       WHERE id=$1 RETURNING *`,[id,v.name??null,v.size??null]);
    await audit(req.principal!.id,'UPDATE','STUDENT_BLOCK',id,{fields:Object.keys(v)});
    return r.rows[0];
  });
  app.get('/api/v1/assignments',async(req)=>{
    const v=z.object({departmentId:uid,termId:uid}).parse(values(req));
    await department(req,v.departmentId);
    await termCheck(v.departmentId,v.termId);
    return (await pool.query(`SELECT a.id,a.block_id,a.course_id,a.term_id,c.code AS course_code,
      b.code AS block_code,b.size,co.code AS cohort_code
      FROM block_course_assignments a JOIN courses c ON c.id=a.course_id
      JOIN student_blocks b ON b.id=a.block_id JOIN cohorts co ON co.id=b.cohort_id
      WHERE c.department_id=$1 AND a.term_id=$2 ORDER BY c.code,co.code,b.code`,
      [v.departmentId,v.termId])).rows;
  });
  app.post('/api/v1/assignments',async(req)=>{
    requireEditor(req);
    const v=z.object({blockId:uid,courseId:uid,termId:uid}).strict().parse(req.body);
    const scope=await blockScope(v.blockId),owner=await courseDepartment(v.courseId);
    await department(req,owner);
    if(scope.department_id!==owner)throw fail('Block and course must belong to same department');
    await termCheck(owner,v.termId);
    const target=await pool.query<{level:number;code:string}>('SELECT level,code FROM courses WHERE id=$1',[v.courseId]);
    if(scope.level!==target.rows[0]!.level)throw fail('Cohort level and course level differ');
    const r=await pool.query(`INSERT INTO block_course_assignments(block_id,course_id,term_id)
       VALUES($1,$2,$3) ON CONFLICT(block_id,course_id,term_id) DO UPDATE SET block_id=EXCLUDED.block_id RETURNING *`,
      [v.blockId,v.courseId,v.termId]);
    await audit(req.principal!.id,'ASSIGN_BLOCK','BLOCK_COURSE_ASSIGNMENT',r.rows[0].id,
      {courseCode:target.rows[0].code});
    return r.rows[0];
  });
  app.delete('/api/v1/assignments/:id',async(req)=>{
    requireEditor(req);
    const id=idParam(req);
    const row=await pool.query<{department_id:string}>(`SELECT c.department_id FROM block_course_assignments a
      JOIN courses c ON c.id=a.course_id WHERE a.id=$1`,[id]);
    if(!row.rows[0])throw fail('Assignment not found',404);
    await department(req,row.rows[0].department_id);
    await pool.query('DELETE FROM block_course_assignments WHERE id=$1',[id]);
    await audit(req.principal!.id,'UNASSIGN_BLOCK','BLOCK_COURSE_ASSIGNMENT',id);
    return {ok:true};
  });
  app.get('/api/v1/demand',async(req)=>{
    const v=z.object({departmentId:uid,termId:uid}).parse(values(req));
    await department(req,v.departmentId);
    await termCheck(v.departmentId,v.termId);
    return (await pool.query(`SELECT e.id,e.course_id,c.code AS course_code,c.title,e.term_id,e.base_students,
      e.repeat_rate,e.projected_students,e.source,e.confidence,e.notes,e.updated_at
      FROM demand_estimates e JOIN courses c ON c.id=e.course_id
      WHERE c.department_id=$1 AND e.term_id=$2 ORDER BY c.code`,[v.departmentId,v.termId])).rows;
  });
  app.put('/api/v1/demand',async(req)=>{
    requireEditor(req);
    const v=z.object({
      courseId:uid,termId:uid,baseStudents:z.number().int().min(0).max(5000),
      repeatRate:z.number().min(0).max(0.5).default(0.05),
      source:z.string().trim().min(3).max(240),
      confidence:z.enum(['LOW','MEDIUM','HIGH']).default('MEDIUM'),
      notes:z.string().max(1000).nullable().optional()
    }).strict().parse(req.body);
    const owner=await courseDepartment(v.courseId);
    await department(req,owner);
    await termCheck(owner,v.termId);
    const projected=Math.ceil(v.baseStudents*(1+v.repeatRate));
    const r=await pool.query(`INSERT INTO demand_estimates
      (course_id,term_id,base_students,repeat_rate,projected_students,source,confidence,notes,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(course_id,term_id) DO UPDATE SET base_students=EXCLUDED.base_students,
       repeat_rate=EXCLUDED.repeat_rate,projected_students=EXCLUDED.projected_students,
       source=EXCLUDED.source,confidence=EXCLUDED.confidence,notes=EXCLUDED.notes,
       updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
      [v.courseId,v.termId,v.baseStudents,v.repeatRate,projected,v.source,v.confidence,
       v.notes??null,req.principal!.id]);
    await audit(req.principal!.id,'UPSERT','DEMAND_ESTIMATE',r.rows[0].id,
      {projected,courseId:v.courseId,termId:v.termId,source:v.source});
    return r.rows[0];
  });
}
