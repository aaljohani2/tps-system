import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool} from './database.js';
import {allowedDepartment,canApprove,requireEditor} from './security.js';

const uid=z.string().uuid();
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
async function dept(courseId:string){
  const q=await pool.query<{department_id:string}>('SELECT department_id FROM courses WHERE id=$1',[courseId]);
  if(!q.rows[0])throw fail('Course not found',404);
  return q.rows[0].department_id;
}
export async function registerPrerequisites(app:FastifyInstance){
  app.get('/api/v1/prerequisites',async(req)=>{
    const v=z.object({departmentId:uid}).parse(req.query);
    if(!await allowedDepartment(req.principal!,v.departmentId))throw fail('Scope denied',403);
    return (await pool.query(`SELECT p.id,p.course_id,p.prerequisite_course_id,
      c.code AS course_code,c.title AS course_title,
      prior.code AS prerequisite_code,prior.title AS prerequisite_title
      FROM course_prerequisites p JOIN courses c ON c.id=p.course_id
      JOIN courses prior ON prior.id=p.prerequisite_course_id
      WHERE c.department_id=$1 ORDER BY c.code,prior.code`,[v.departmentId])).rows;
  });
  app.post('/api/v1/prerequisites',async(req)=>{
    requireEditor(req);
    const v=z.object({courseId:uid,prerequisiteCourseId:uid}).strict().parse(req.body);
    if(v.courseId===v.prerequisiteCourseId)throw fail('A course cannot require itself');
    const owner=await dept(v.courseId);
    if(!await allowedDepartment(req.principal!,owner))throw fail('Scope denied',403);
    if(owner!==await dept(v.prerequisiteCourseId))throw fail('Prerequisites must be in the same department');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      // Serialize modifications to the same department to avoid concurrent cycle creation.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['prereq:'+owner]);
      const cycle=await client.query(`WITH RECURSIVE chain(course_id) AS (
        SELECT prerequisite_course_id FROM course_prerequisites WHERE course_id=$1
        UNION SELECT p.prerequisite_course_id FROM course_prerequisites p
          JOIN chain x ON p.course_id=x.course_id
      ) SELECT 1 FROM chain WHERE course_id=$2 LIMIT 1`,[v.prerequisiteCourseId,v.courseId]);
      if(cycle.rowCount)throw fail('Circular prerequisite chain is not allowed',409);
      const r=await client.query<{id:string}>(`INSERT INTO course_prerequisites(course_id,prerequisite_course_id,created_by)
        VALUES($1,$2,$3) ON CONFLICT(course_id,prerequisite_course_id)
        DO UPDATE SET course_id=EXCLUDED.course_id RETURNING id`,[
        v.courseId,v.prerequisiteCourseId,req.principal!.id
      ]);
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'UPSERT','COURSE_PREREQUISITE',$2,$3::jsonb)`,[
        req.principal!.id,r.rows[0]!.id,JSON.stringify(v)
      ]);
      await client.query('COMMIT');
      return {id:r.rows[0]!.id,...v};
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });
  app.delete('/api/v1/prerequisites/:id',async(req)=>{
    requireEditor(req);
    const id=uid.parse((req.params as {id:string}).id);
    const row=await pool.query<{department_id:string}>(`SELECT c.department_id FROM course_prerequisites p
      JOIN courses c ON c.id=p.course_id WHERE p.id=$1`,[id]);
    if(!row.rows[0])throw fail('Prerequisite not found',404);
    if(!await allowedDepartment(req.principal!,row.rows[0].department_id))throw fail('Scope denied',403);
    await pool.query('DELETE FROM course_prerequisites WHERE id=$1',[id]);
    await pool.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id)
      VALUES($1,'DELETE','COURSE_PREREQUISITE',$2)`,[req.principal!.id,id]);
    return {ok:true};
  });
  app.post('/api/v1/plans/:id/activate',async(req)=>{
    if(!canApprove(req.principal!))throw fail('Approver required',403);
    const id=uid.parse((req.params as {id:string}).id);
    const note=z.object({reason:z.string().trim().min(8).max(1200)}).strict().parse(req.body);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const plan=await client.query<{program_id:string;department_id:string;state:string}>(`
        SELECT cp.program_id,p.department_id,cp.state FROM curriculum_plans cp
        JOIN training_programs p ON p.id=cp.program_id
        WHERE cp.id=$1 FOR UPDATE OF cp`,[id]);
      const p=plan.rows[0];
      if(!p)throw fail('Plan not found',404);
      if(!await allowedDepartment(req.principal!,p.department_id))throw fail('Scope denied',403);
      if(p.state!=='DRAFT')throw fail('Only a draft curriculum plan can be activated',409);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['plan:'+p.program_id]);
      const items=await client.query<{course_id:string;level:number}>(`
        SELECT course_id,level FROM curriculum_items WHERE plan_id=$1`,[id]);
      if(!items.rows.length)throw fail('Cannot activate an empty plan',409);
      const levels=new Map(items.rows.map(x=>[x.course_id,x.level]));
      const missing=await client.query<{code:string;prerequisite_id:string;prerequisite_level:number}>(`
        SELECT c.code,pre.prerequisite_course_id AS prerequisite_id,ci.level AS prerequisite_level
        FROM curriculum_items ci JOIN courses c ON c.id=ci.course_id
        JOIN course_prerequisites pre ON pre.course_id=ci.course_id
        WHERE ci.plan_id=$1`,[id]);
      for(const requirement of missing.rows){
        const courseLevel=items.rows.find(x=>x.course_id===undefined)?.level;
        void courseLevel; // Actual course-level comparison is resolved below using the course code mapping.
        if(!levels.has(requirement.prerequisite_id))
          throw fail('Prerequisite missing from plan for course '+requirement.code,409);
      }
      const ordering=await client.query<{course_code:string;course_level:number;prerequisite_level:number}>(`
        SELECT c.code AS course_code,ci.level AS course_level,prior_ci.level AS prerequisite_level
        FROM curriculum_items ci JOIN courses c ON c.id=ci.course_id
        JOIN course_prerequisites pre ON pre.course_id=ci.course_id
        JOIN curriculum_items prior_ci ON prior_ci.plan_id=ci.plan_id
          AND prior_ci.course_id=pre.prerequisite_course_id
        WHERE ci.plan_id=$1`,[id]);
      if(ordering.rows.some(x=>x.prerequisite_level>=x.course_level))
        throw fail('Every prerequisite must precede its dependent course in the plan',409);
      await client.query(`UPDATE curriculum_plans SET state='ARCHIVED'
        WHERE program_id=$1 AND state='ACTIVE'`,[p.program_id]);
      const updated=await client.query(`UPDATE curriculum_plans SET state='ACTIVE',
        activated_at=now(),activated_by=$2,activation_reason=$3
        WHERE id=$1 AND state='DRAFT' RETURNING id,code,state,activated_at`,[
        id,req.principal!.id,note.reason
      ]);
      if(!updated.rowCount)throw fail('Concurrent plan activation',409);
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'ACTIVATE_PLAN','CURRICULUM_PLAN',$2,$3::jsonb)`,[
        req.principal!.id,id,JSON.stringify({reason:note.reason,programId:p.program_id})
      ]);
      await client.query('COMMIT');
      return updated.rows[0];
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  });
}
