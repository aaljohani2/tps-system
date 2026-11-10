import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool} from './database.js';
import {allowedDepartment,requireEditor} from './security.js';
import {moveScheduledSession} from '../manual-schedule.js';
import type {Day,PlanRequest,PlanResult} from '../types.js';

const uuid=z.string().uuid();
const fail=(text:string,statusCode=400)=>Object.assign(new Error(text),{statusCode});
const pathParams=z.object({id:uuid,sessionId:z.string().min(1).max(240)});
const edit=z.object({
  editVersion:z.number().int().nonnegative(),
  day:z.enum(['SUN','MON','TUE','WED','THU']),
  start:z.number().min(0).max(23.5).multipleOf(0.5),
  roomId:z.string().min(1).max(100).nullable(),
  instructorId:z.string().min(1).max(100),
  reason:z.string().trim().min(8).max(1000)
}).strict();
export async function registerManualScheduling(app:FastifyInstance):Promise<void>{
  app.get('/api/v1/scenarios/:id/edits',async(req)=>{
    const id=uuid.parse((req.params as {id:string}).id);
    const s=await pool.query<{department_id:string}>('SELECT department_id FROM scenarios WHERE id=$1',[id]);
    if(!s.rows[0])throw fail('Scenario not found',404);
    if(!await allowedDepartment(req.principal!,s.rows[0].department_id))throw fail('Scope denied',403);
    return (await pool.query(`SELECT id,scenario_id,edit_version,session_id,before_snapshot,
       after_snapshot,reason,edited_by,edited_at
       FROM scenario_session_edits WHERE scenario_id=$1 ORDER BY edit_version DESC LIMIT 100`,[id])).rows;
  });
  app.patch('/api/v1/scenarios/:id/sessions/:sessionId',async(req)=>{
    requireEditor(req);
    const {id,sessionId}=pathParams.parse(req.params);
    const change=edit.parse(req.body);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const r=await client.query<{department_id:string;state:string;solver_status:string;edit_version:number;
        input_snapshot:PlanRequest;result_snapshot:PlanResult;solver_details:unknown}>(
        'SELECT department_id,state,solver_status,edit_version,input_snapshot,result_snapshot,solver_details FROM scenarios WHERE id=$1 FOR UPDATE',[id]);
      const scenario=r.rows[0];
      if(!scenario)throw fail('Scenario not found',404);
      if(!await allowedDepartment(req.principal!,scenario.department_id))throw fail('Scope denied',403);
      if(scenario.state!=='DRAFT'||scenario.solver_status!=='COMPLETED')
        throw fail('Manual rescheduling is permitted only for a solved DRAFT',409);
      if(change.editVersion!==scenario.edit_version)
        throw fail('Another editor has changed this scenario. Refresh before editing.',409);
      const original=scenario.result_snapshot.sessions.find(s=>s.id===sessionId);
      if(!original)throw fail('Session does not exist in this scenario',404);
      const next=moveScheduledSession(scenario.input_snapshot,scenario.result_snapshot,{
        sessionId,day:change.day as Day,start:change.start,
        instructorId:change.instructorId,roomId:change.roomId
      });
      const updated=next.sessions.find(s=>s.id===sessionId)!;
      const version=scenario.edit_version+1;
      await client.query(`UPDATE scenarios SET result_snapshot=$2::jsonb,edit_version=$3,
        solver_details=COALESCE(solver_details,'{}'::jsonb) ||
          jsonb_build_object('manualEdits',$3::integer,'lastManualEditAt',now())
        WHERE id=$1`,[id,JSON.stringify(next),version]);
      await client.query(`INSERT INTO scenario_session_edits
        (scenario_id,edit_version,session_id,before_snapshot,after_snapshot,reason,edited_by)
        VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,[
        id,version,sessionId,JSON.stringify(original),JSON.stringify(updated),change.reason,req.principal!.id
      ]);
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'MANUAL_RESCHEDULE','SCENARIO',$2,$3::jsonb)`,[
        req.principal!.id,id,JSON.stringify({version,sessionId,reason:change.reason})
      ]);
      await client.query('COMMIT');
      return {id,editVersion:version,session:updated,readiness:'PASSED',
        result:next,manualAdjustment:true};
    }catch(e){await client.query('ROLLBACK');throw e;}
    finally{client.release();}
  });
}
