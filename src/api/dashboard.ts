import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool} from './database.js';
import {allowedDepartment} from './security.js';

const id=z.string().uuid();
export async function registerDashboard(app:FastifyInstance){
  app.get('/api/v1/dashboard',async(req)=>{
    const {departmentId,termId}=z.object({departmentId:id,termId:id}).parse(req.query);
    if(!await allowedDepartment(req.principal!,departmentId))
      throw Object.assign(new Error('Scope denied'),{statusCode:403});
    const term=await pool.query('SELECT 1 FROM departments d JOIN academic_terms t ON t.college_id=d.college_id WHERE d.id=$1 AND t.id=$2',[departmentId,termId]);
    if(!term.rowCount)throw Object.assign(new Error('Department/term mismatch'),{statusCode:400});
    const summary=await pool.query<{
      courses:string;programs:string;cohorts:string;blocks:string;
      trainers:string;rooms:string;scenarios:string;approved:string;
    }>(`SELECT
      (SELECT count(*) FROM courses WHERE department_id=$1)::text AS courses,
      (SELECT count(*) FROM training_programs WHERE department_id=$1)::text AS programs,
      (SELECT count(*) FROM cohorts WHERE department_id=$1)::text AS cohorts,
      (SELECT count(*) FROM student_blocks b JOIN cohorts co ON co.id=b.cohort_id WHERE co.department_id=$1)::text AS blocks,
      (SELECT count(*) FROM instructors WHERE department_id=$1)::text AS trainers,
      (SELECT count(*) FROM rooms r JOIN departments d ON d.college_id=r.college_id WHERE d.id=$1)::text AS rooms,
      (SELECT count(*) FROM scenarios WHERE department_id=$1 AND term_id=$2)::text AS scenarios,
      (SELECT count(*) FROM scenarios WHERE department_id=$1 AND term_id=$2 AND state='APPROVED')::text AS approved`,
      [departmentId,termId]);
    const demand=await pool.query<{code:string;title:string;projected:number;block_total:number;source:string|null;confidence:string|null}>(`
      SELECT c.code,c.title,COALESCE(e.projected_students,NULLIF(c.demand,0),
        (SELECT sum(b.size) FROM block_course_assignments a JOIN student_blocks b ON b.id=a.block_id
         WHERE a.course_id=c.id AND a.term_id=$2),0)::int AS projected,
        COALESCE((SELECT sum(b.size) FROM block_course_assignments a
          JOIN student_blocks b ON b.id=a.block_id WHERE a.course_id=c.id AND a.term_id=$2),0)::int AS block_total,
        e.source,e.confidence
      FROM courses c LEFT JOIN demand_estimates e ON e.course_id=c.id AND e.term_id=$2
      WHERE c.department_id=$1 ORDER BY c.code`,[departmentId,termId]);
    const recent=await pool.query(`SELECT id,name,state,solver_status,revision,created_at,approved_at
      FROM scenarios WHERE department_id=$1 AND term_id=$2 ORDER BY created_at DESC LIMIT 8`,[departmentId,termId]);
    const total=demand.rows.reduce((n,v)=>n+v.projected,0);
    const blockTotal=demand.rows.reduce((n,v)=>n+v.block_total,0);
    return {scope:{departmentId,termId},counts:Object.fromEntries(
      Object.entries(summary.rows[0]??{}).map(([k,v])=>[k,Number(v)])),
      demand:{projected:total,assignedBlocks: blockTotal,
        mismatchedCourses:demand.rows.filter(v=>v.block_total>0&&v.block_total!==v.projected).length,
        withoutBlockLinks:demand.rows.filter(v=>v.projected>0&&v.block_total===0).length,
        courses:demand.rows},
      recentScenarios:recent.rows};
  });
}
