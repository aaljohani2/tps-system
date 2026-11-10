import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool} from './database.js';
import {allowedDepartment,canApprove,requireEditor} from './security.js';

const id=z.string().uuid();
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
async function owner(instructorId:string,termId:string){
  const row=await pool.query<{department_id:string}>(`SELECT i.department_id FROM instructors i
    JOIN departments d ON d.id=i.department_id
    JOIN academic_terms t ON t.college_id=d.college_id
    WHERE i.id=$1 AND t.id=$2`,[instructorId,termId]);
  if(!row.rows[0])throw fail('Trainer and term do not belong to the same college',400);
  return row.rows[0].department_id;
}
export async function registerLoadExceptions(app:FastifyInstance):Promise<void>{
  app.get('/api/v1/load-exceptions',async(req)=>{
    const v=z.object({departmentId:id,termId:id}).parse(req.query);
    if(!await allowedDepartment(req.principal!,v.departmentId))throw fail('Scope denied',403);
    const valid=await pool.query('SELECT 1 FROM departments d JOIN academic_terms t ON d.college_id=t.college_id WHERE d.id=$1 AND t.id=$2',[v.departmentId,v.termId]);
    if(!valid.rowCount)throw fail('Department/term mismatch',400);
    return (await pool.query(`SELECT e.id,e.instructor_id,e.term_id,i.code AS instructor_code,
      i.name AS instructor_name,e.additional_hours,e.reason,e.state,e.created_at,
      e.decided_at,e.decision_reason FROM instructor_load_exceptions e
      JOIN instructors i ON i.id=e.instructor_id
      WHERE i.department_id=$1 AND e.term_id=$2 ORDER BY e.created_at DESC LIMIT 200`,
      [v.departmentId,v.termId])).rows;
  });
  app.post('/api/v1/load-exceptions',async(req)=>{
    requireEditor(req);
    const v=z.object({instructorId:id,termId:id,
      additionalHours:z.number().positive().max(30).multipleOf(0.5),
      reason:z.string().trim().min(8).max(1000)}).strict().parse(req.body);
    const dept=await owner(v.instructorId,v.termId);
    if(!await allowedDepartment(req.principal!,dept))throw fail('Scope denied',403);
    const r=await pool.query<{id:string}>(`INSERT INTO instructor_load_exceptions
      (instructor_id,term_id,additional_hours,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [v.instructorId,v.termId,v.additionalHours,v.reason,req.principal!.id]);
    await pool.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
      VALUES($1,'REQUEST_LOAD_EXCEPTION','LOAD_EXCEPTION',$2,$3::jsonb)`,[
      req.principal!.id,r.rows[0]!.id,JSON.stringify({termId:v.termId,additionalHours:v.additionalHours})
    ]);
    return {id:r.rows[0]!.id,state:'PENDING'};
  });
  app.post('/api/v1/load-exceptions/:id/decision',async(req)=>{
    if(!canApprove(req.principal!))throw fail('Approver required',403);
    const exceptionId=id.parse((req.params as {id:string}).id);
    const v=z.object({decision:z.enum(['APPROVED','REJECTED']),reason:z.string().trim().min(8).max(1000)}).strict().parse(req.body);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const current=await client.query<{instructor_id:string;term_id:string;state:string}>(`
        SELECT instructor_id,term_id,state FROM instructor_load_exceptions WHERE id=$1 FOR UPDATE`,[exceptionId]);
      const row=current.rows[0];
      if(!row)throw fail('Exception not found',404);
      const dept=await owner(row.instructor_id,row.term_id);
      if(!await allowedDepartment(req.principal!,dept))throw fail('Scope denied',403);
      if(row.state!=='PENDING')throw fail('Exception already decided',409);
      if(v.decision==='APPROVED'){
        // Per trainer+term advisory transaction lock prevents two simultaneous approvers from
        // replacing an approved exception in different transactions.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[row.instructor_id+':'+row.term_id]);
        await client.query(`UPDATE instructor_load_exceptions SET state='SUPERSEDED',
          decided_at=now(),decision_reason='Superseded by newly approved exception'
          WHERE instructor_id=$1 AND term_id=$2 AND state='APPROVED'`,
          [row.instructor_id,row.term_id]);
      }
      const updated=await client.query(`UPDATE instructor_load_exceptions
        SET state=$2,decided_by=$3,decided_at=now(),decision_reason=$4
        WHERE id=$1 AND state='PENDING' RETURNING id,state`,[
        exceptionId,v.decision,req.principal!.id,v.reason
      ]);
      if(!updated.rows.length)throw fail('Concurrent exception decision',409);
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'LOAD_EXCEPTION_DECISION','LOAD_EXCEPTION',$2,$3::jsonb)`,[
        req.principal!.id,exceptionId,JSON.stringify({decision:v.decision,reason:v.reason})
      ]);
      await client.query('COMMIT');
      return updated.rows[0];
    }catch(e){await client.query('ROLLBACK');throw e;}
    finally{client.release();}
  });
}
