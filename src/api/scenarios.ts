import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {pool} from './database.js';
import {audit,allowedDepartment,canApprove,requireEditor} from './security.js';
import {defaultPolicy} from '../policy.js';
import {buildDraftPlan} from '../planner.js';
import {optimizeWithTimefold} from '../optimizer.js';
import {validateRequest} from '../validation.js';
import {exportScenarioXlsx} from './excel.js';
import {renderPrintableScenario} from '../print-report.js';
import {getEffectivePolicy} from './policies.js';
import {assessReadiness} from './readiness.js';
import type {Course,Instructor,PlanRequest,PlanResult,Policy,Room} from '../types.js';

const uuid=z.string().uuid();
// A single local API process owns each live Java child. Abandoned runs use
// guarded recovery and cannot be mistaken for cancellable live processes.
const activeSolverControllers=new Map<string,AbortController>();
let pendingSolverClaims=0; // Count claims awaiting PostgreSQL to bound local Java processes.
const solveSettings=z.object({
  seconds:z.number().int().min(1).max(30).default(5),
  candidatesPerInstructor:z.number().int().min(1).max(24).default(6)
}).strict();
/** Bound work before invoking either the greedy baseline or the candidate-limited Java optimizer. */
export function projectedSectionCount(input:PlanRequest):number{
  return input.courses.reduce((total,c)=>{
    if(c.demand===0)return total;
    if(c.blockSizes)return total+c.blockSizes.length;
    if(c.mode==='SELF_PACED')return total+1;
    const cap=input.policy.capacities[c.mode];
    const limit=c.theoryHours>0&&c.practicalHours>0?Math.min(cap.theory!,cap.practical!):
      c.theoryHours>0?cap.theory!:cap.practical!;
    if(!Number.isFinite(limit)||limit<=0)throw new Error('Invalid course capacity in policy');
    return total+Math.ceil(c.demand/limit);
  },0);
}
function boundedDraft(input:PlanRequest):PlanResult{
  validateRequest(input);
  if(projectedSectionCount(input)>250)throw Object.assign(
    new Error('Scenario exceeds the 250-section limit of the experimental Timefold candidate solver'),
    {statusCode:400});
  return buildDraftPlan(input);
}

const invalid=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const params=(req:FastifyRequest)=>uuid.parse((req.params as {id:string}).id);
async function scope(req:FastifyRequest,departmentId:string){
  if(!await allowedDepartment(req.principal!,departmentId))throw invalid('Scope denied',403);
}
interface Stored {
  id:string;department_id:string;term_id:string;name:string;state:string;solver_status:string;
  input_snapshot:PlanRequest;result_snapshot:PlanResult;solver_details:unknown;approved_snapshot:unknown;revision:number;policy_revision:number;parent_scenario_id:string|null;
}
async function find(req:FastifyRequest,id:string):Promise<Stored>{
  const r=await pool.query<Stored>('SELECT * FROM scenarios WHERE id=$1',[id]);
  const row=r.rows[0];if(!row)throw invalid('Scenario not found',404);
  await scope(req,row.department_id);
  return row;
}
async function fromDatabase(departmentId:string,termId:string,name:string,policy:Policy):Promise<PlanRequest>{
  const d=await pool.query<{college_id:string}>('SELECT college_id FROM departments WHERE id=$1',[departmentId]);
  const collegeId=d.rows[0]?.college_id;
  if(!collegeId)throw invalid('Department not found',404);
  const term=await pool.query('SELECT id FROM academic_terms WHERE id=$1 AND college_id=$2',[termId,collegeId]);
  if(!term.rowCount)throw invalid('Term does not belong to selected college');
  const [coursesRaw,instructorsRaw,roomsRaw,demandRaw,blocksRaw,exceptionsRaw]=await Promise.all([
    pool.query('SELECT * FROM courses WHERE department_id=$1 ORDER BY code',[departmentId]),
    pool.query('SELECT * FROM instructors WHERE department_id=$1 ORDER BY code',[departmentId]),
    pool.query('SELECT * FROM rooms WHERE college_id=$1 ORDER BY code',[collegeId]),
    pool.query('SELECT de.course_id,de.projected_students FROM demand_estimates de JOIN courses c ON c.id=de.course_id WHERE c.department_id=$1 AND de.term_id=$2',[departmentId,termId]),
    pool.query(`SELECT a.course_id,b.size,(co.code || '::' || b.code) AS block_ref
      FROM block_course_assignments a JOIN courses c ON c.id=a.course_id
      JOIN student_blocks b ON b.id=a.block_id JOIN cohorts co ON co.id=b.cohort_id
      WHERE c.department_id=$1 AND a.term_id=$2 ORDER BY co.code,b.code`,[departmentId,termId]),
    pool.query(`SELECT i.code,e.additional_hours,e.reason FROM instructor_load_exceptions e
      JOIN instructors i ON i.id=e.instructor_id
      WHERE i.department_id=$1 AND e.term_id=$2 AND e.state='APPROVED'`,[departmentId,termId])
  ]);
  const estimateByCourse=new Map<string,number>(demandRaw.rows.map(v=>[v.course_id,Number(v.projected_students)]));
  const assignedByCourse=new Map<string,Array<{ref:string;size:number}>>();
  for(const row of blocksRaw.rows){
    const items=assignedByCourse.get(row.course_id)??[];
    items.push({ref:row.block_ref,size:Number(row.size)});
    assignedByCourse.set(row.course_id,items);
  }
  const courses:Course[]=coursesRaw.rows.map(c=>{
    const links=assignedByCourse.get(c.id)??[];
    const blockTotal=links.reduce((sum,b)=>sum+b.size,0);
    const projected=estimateByCourse.get(c.id);
    const demand=projected??(c.demand>0?c.demand:blockTotal);
    if(links.length && blockTotal!==demand)
      throw invalid(`Block sizes for ${c.code} total ${blockTotal} while approved planning demand is ${demand}; reconcile before scheduling`,409);
    return {
      code:c.code,title:c.title,level:c.level,demand,theoryHours:c.theory_hours,
      practicalHours:c.practical_hours,mode:c.mode,eligibleModes:c.eligible_modes,
      blocks:links.length?links.map(b=>b.ref):(c.blocks.length?c.blocks:undefined),
      blockSizes:links.length?links.map(b=>b.size):undefined,
      hybridSplit:c.hybrid_split??undefined,
      assignedInstructorId:c.assigned_instructor_id??undefined,
      exclusiveInstructor:c.exclusive_instructor
    };
  });
  const approvedExtra=new Map<string,{additionalHours:number;reason:string}>(
    exceptionsRaw.rows.map(x=>[x.code,{additionalHours:Number(x.additional_hours),reason:x.reason}])
  );
  const instructors:Instructor[]=instructorsRaw.rows.map(i=>({
    id:i.code,name:i.name,maxLoad:Number(i.max_load),allowedModes:i.allowed_modes,
    eligibleCourseCodes:i.eligible_course_codes??undefined,available:i.available??undefined,
    overload:approvedExtra.get(i.code)
  }));
  const rooms:Room[]=roomsRaw.rows.map(r=>({
    id:r.code,name:r.name,type:r.type,capacity:r.capacity,available:r.available??undefined
  }));
  return {scenarioName:name,termId,courses,instructors,rooms,policy};
}
const selectInput=z.object({departmentId:uuid,termId:uuid,name:z.string().trim().min(1).max(160),
}).strict();
function csvCell(v:unknown):string{
  const raw=String(v??'');
  const guarded=/^[\s]*[=+@-]/.test(raw)?"'"+raw:raw;
  return '"'+guarded.replace(/"/g,'""')+'"';
}
export async function registerScenarios(app:FastifyInstance):Promise<void>{
  app.get('/api/v1/scenarios',async(req)=>{
    // Preserve the legacy array response for React while allowing bounded paging.
    const params=z.object({
      departmentId:uuid,termId:uuid.optional(),
      limit:z.coerce.number().int().min(1).max(100).default(100),
      offset:z.coerce.number().int().min(0).max(10000).default(0),
      search:z.string().trim().max(120).default('')
    }).strict().parse(req.query);
    await scope(req,params.departmentId);
    const rows=await pool.query(`SELECT id,department_id,term_id,name,state,solver_status,revision,policy_revision,parent_scenario_id,created_at,approved_at
      FROM scenarios WHERE department_id=$1 AND ($2::uuid IS NULL OR term_id=$2)
      AND ($3::text='' OR name ILIKE '%' || $3 || '%')
      ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,[
        params.departmentId,params.termId??null,params.search,params.limit,params.offset
      ]);
    return rows.rows;
  });
  app.post('/api/v1/scenarios',async(req)=>{
    requireEditor(req);
    const parsed=selectInput.safeParse(req.body);
    if(!parsed.success)throw invalid('Invalid scenario context');
    const v=parsed.data;
    await scope(req,v.departmentId);
    const {policy,revision}=await getEffectivePolicy(v.departmentId,v.termId);
    const input=await fromDatabase(v.departmentId,v.termId,v.name,policy);
    validateRequest(input);
    if(!input.courses.length)throw invalid('Import or enter courses first');
    const result=boundedDraft(input);
    const r=await pool.query<{id:string}>(`INSERT INTO scenarios
      (department_id,term_id,name,state,solver_status,input_snapshot,result_snapshot,created_by,policy_revision)
      VALUES($1,$2,$3,'DRAFT','NOT_RUN',$4,$5,$6,$7) RETURNING id`,[
      v.departmentId,v.termId,v.name,JSON.stringify(input),JSON.stringify(result),req.principal!.id,revision
    ]);
    await audit(req.principal!.id,'CREATE','SCENARIO',r.rows[0]!.id);
    return {id:r.rows[0]!.id,state:'DRAFT',solverStatus:'NOT_RUN',result};
  });
  app.get('/api/v1/scenarios/:id',async(req)=>find(req,params(req)));
  app.get('/api/v1/scenarios/:id/readiness',async(req)=>{
    const sc=await find(req,params(req));
    return assessReadiness(sc.input_snapshot,sc.result_snapshot,sc.solver_status);
  });
  app.get('/api/v1/scenarios/:id/runs',async(req)=>{
    const sc=await find(req,params(req));
    return (await pool.query(`SELECT id,scenario_id,requested_by,status,started_at,
      finished_at,elapsed_ms,result_metrics,score,error_message,
       progress_stage,progress_at,requested_settings
       FROM solver_runs WHERE scenario_id=$1 ORDER BY started_at DESC LIMIT 100`,[sc.id])).rows;
  });
  app.post('/api/v1/scenarios/:id/runs/recover',async(req)=>{
    requireEditor(req);
    const id=params(req);
    await find(req,id); // scope and existence check
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const locked=await client.query<{state:string;solver_status:string}>(`
        SELECT state,solver_status FROM scenarios WHERE id=$1 FOR UPDATE`,[id]);
      if(locked.rows[0]?.state!=='DRAFT'||locked.rows[0].solver_status!=='RUNNING')
        throw invalid('No running draft solver to recover',409);
      // Never interrupt a live Java process; only mark a run abandoned after
      // twice the maximum permitted process timeout has elapsed.
      const stale=await client.query<{id:string}>(`
        SELECT id FROM solver_runs
        WHERE scenario_id=$1 AND status='RUNNING'
        AND started_at<now()-interval '2 minutes' FOR UPDATE`,[id]);
      if(!stale.rows.length)throw invalid('Solver run is active or not old enough for recovery',409);
      await client.query(`UPDATE solver_runs SET status='FAILED',progress_stage='FAILED',progress_at=now(),finished_at=now(),
        error_message='Recovered abandoned solver after >2 minutes'
        WHERE id=$1`,[stale.rows[0]!.id]);
      await client.query(`UPDATE scenarios SET solver_status='FAILED' WHERE id=$1
        AND state='DRAFT' AND solver_status='RUNNING'`,[id]);
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'RECOVER_SOLVER','SCENARIO',$2,$3::jsonb)`,[
        req.principal!.id,id,JSON.stringify({runId:stale.rows[0]!.id})
      ]);
      await client.query('COMMIT');
      return {id,status:'FAILED',recovered:true};
    }catch(e){await client.query('ROLLBACK');throw e;}
    finally{client.release();}
  });
  app.post('/api/v1/scenarios/:id/runs/cancel',async(req)=>{
    requireEditor(req);
    const id=params(req),sc=await find(req,id);
    if(sc.state!=='DRAFT'||sc.solver_status!=='RUNNING')
      throw invalid('Only an active DRAFT solver can be cancelled',409);
    const controller=activeSolverControllers.get(id);
    if(!controller || controller.signal.aborted)
      throw invalid('No attached live local solver process; use guarded recovery if applicable',409);
    // Reserve cancellation in PostgreSQL first. A completed run cannot be erased.
    const client=await pool.connect();
    let runId:string;
    try{
      await client.query('BEGIN');
      const updated=await client.query(`UPDATE scenarios SET solver_status='FAILED'
        WHERE id=$1 AND state='DRAFT' AND solver_status='RUNNING' RETURNING id`,[id]);
      if(!updated.rowCount)throw invalid('Solver already finished or changed state',409);
      const cancelled=await client.query<{id:string}>(`UPDATE solver_runs SET
        status='CANCELLED', progress_stage='CANCELLED',progress_at=now(),finished_at=now(),
        elapsed_ms=GREATEST(0,(EXTRACT(EPOCH FROM (now()-started_at))*1000)::integer),
        error_message='Cancelled by authorized operator'
        WHERE scenario_id=$1 AND status='RUNNING' RETURNING id`,[id]);
      if(cancelled.rowCount!==1)throw invalid('Active run was not recorded; cancellation rolled back',409);
      runId=cancelled.rows[0]!.id;
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'CANCEL_SOLVER','SCENARIO',$2,$3::jsonb)`,[
          req.principal!.id,id,JSON.stringify({runId})
        ]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}
    finally{client.release();}
    controller.abort();
    return {id,runId,status:'CANCELLED',solverStatus:'FAILED'};
  });
  // Legacy synchronous route is retained for existing API clients and regression tests.
  // The async route commits the run claim before acknowledging, then continues
  // in this local process independently of the browser's HTTP connection.
  async function solveScenario(req:FastifyRequest,asynchronous:boolean){
    requireEditor(req);
    const id=params(req),sc=await find(req,id);
    if(sc.state!=='DRAFT')throw invalid('Only a DRAFT may be solved',409);
    const options=solveSettings.parse(req.body??{});
    if(activeSolverControllers.has(id))throw invalid('Previous local solver is still terminating',409);
    if(activeSolverControllers.size+pendingSolverClaims>=2)
      throw invalid('At most two local Java solver processes may run concurrently',429);
    pendingSolverClaims++;
    let runId:string;
    try{
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const claim=await client.query(`UPDATE scenarios SET solver_status='RUNNING'
          WHERE id=$1 AND state='DRAFT' AND solver_status IN ('NOT_RUN','FAILED')
          RETURNING id`,[id]);
        if(!claim.rowCount)throw invalid('Solver already running or scenario already solved',409);
        const run=await client.query<{id:string}>(`INSERT INTO solver_runs
          (scenario_id,requested_by,progress_stage,requested_settings)
          VALUES($1,$2,'QUEUED',$3::jsonb) RETURNING id`,
          [id,req.principal!.id,JSON.stringify(options)]);
        runId=run.rows[0]!.id;
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e;}
      finally{client.release();}
    }finally{pendingSolverClaims--;}
    const controller=new AbortController();
    activeSolverControllers.set(id,controller);
    const operatorId=req.principal!.id;
    const began=Date.now();
    const markStage=async(stage:'VALIDATING'|'PREPARING'|'SOLVING'|'VERIFYING'|'SAVING')=>{
      const changed=await pool.query(`UPDATE solver_runs SET progress_stage=$2,progress_at=now()
        WHERE id=$1 AND status='RUNNING' RETURNING id`,[runId,stage]);
      if(!changed.rowCount)throw invalid('Solver run no longer active',409);
    };
    const performSolve=async()=>{
      try{
        await markStage('VALIDATING');
        if(controller.signal.aborted)throw invalid('Solver cancelled by operator',409);
        validateRequest(sc.input_snapshot);
        const result=await optimizeWithTimefold(sc.input_snapshot,{
          signal:controller.signal,...options,onStage:markStage
        });
        if(controller.signal.aborted)throw invalid('Solver cancelled by operator',409);
        const elapsed=Date.now()-began;
        const scoreText=result.notices.find(n=>n.startsWith('Solver score: '))??'';
        const groups=/hard=([-]?[0-9]+), soft=([-]?[0-9]+)/.exec(scoreText);
        const score=groups?{hard:Number(groups[1]),soft:Number(groups[2])}:null;
        await markStage('SAVING');
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          // Guard both scenario state AND this exact run. A cancellation or
          // recovery must never be overwritten by an outdated Java response.
          const saved=await client.query(`UPDATE scenarios SET result_snapshot=$2,solver_status='COMPLETED',
            solver_details=$3 WHERE id=$1 AND state='DRAFT' AND solver_status='RUNNING'
            AND EXISTS(SELECT 1 FROM solver_runs WHERE id=$4 AND scenario_id=$1 AND status='RUNNING')
            RETURNING id`,[id,JSON.stringify(result),
              JSON.stringify({mode:'Timefold',runId,elapsedMs:elapsed,score,settings:options,at:new Date().toISOString()}),
              runId]);
          if(!saved.rowCount)throw invalid('Scenario or run state changed while solving',409);
          const updated=await client.query(`UPDATE solver_runs SET status='COMPLETED',
            progress_stage='COMPLETED',progress_at=now(),finished_at=now(),
            elapsed_ms=$2,result_metrics=$3::jsonb,score=$4::jsonb
            WHERE id=$1 AND status='RUNNING' RETURNING id`,
            [runId,elapsed,JSON.stringify(result.metrics),JSON.stringify(score)]);
          if(!updated.rowCount)throw invalid('Run cancelled before committing result',409);
          await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
            VALUES($1,'SOLVE','SCENARIO',$2,$3::jsonb)`,
            [operatorId,id,JSON.stringify({runId,gaps:result.gaps.length,elapsedMs:elapsed,settings:options})]);
          await client.query('COMMIT');
        }catch(e){await client.query('ROLLBACK');throw e;}
        finally{client.release();}
        return {id,result,solverStatus:'COMPLETED',runId,elapsedMs:elapsed};
      }catch(e){
        const elapsed=Date.now()-began;
        // Preserve an explicitly CANCELLED attempt; do not convert it to FAILED.
        try{
          await pool.query(`UPDATE solver_runs SET status='FAILED',progress_stage='FAILED',
            progress_at=now(),finished_at=now(),elapsed_ms=$2,error_message=$3
            WHERE id=$1 AND status='RUNNING'`,
            [runId,elapsed,String(e instanceof Error?e.message:e).slice(0,1000)]);
          await pool.query(`UPDATE scenarios SET solver_status='FAILED'
            WHERE id=$1 AND state='DRAFT' AND solver_status='RUNNING'`,[id]);
        }catch(cleanupError){app.log.error({cleanupError,runId},'Timefold run cleanup failed');}
        if(controller.signal.aborted)throw invalid('Solver cancelled by operator',409);
        throw e;
      }finally{
        activeSolverControllers.delete(id);
      }
    };
    if(asynchronous){
      void performSolve().catch(error=>app.log.warn({error,runId},'Asynchronous Timefold run ended without result'));
      return {id,runId,solverStatus:'RUNNING',accepted:true};
    }
    return await performSolve();
  }
  app.post('/api/v1/scenarios/:id/solve',async(req)=>solveScenario(req,false));
  app.post('/api/v1/scenarios/:id/solve/async',async(req,reply)=>{
    const accepted=await solveScenario(req,true);
    return reply.code(202).send(accepted);
  });
  app.post('/api/v1/scenarios/:id/review',async(req)=>{
    requireEditor(req);const id=params(req),sc=await find(req,id);
    if(sc.state!=='DRAFT'||sc.solver_status!=='COMPLETED')throw invalid('Solve successfully with Timefold before review',409);
    const updated=await pool.query(`UPDATE scenarios SET state='UNDER_REVIEW' WHERE id=$1 AND state='DRAFT' AND solver_status='COMPLETED' RETURNING id`,[id]);
    if(!updated.rowCount)throw invalid('Scenario changed during review request',409);
    await audit(req.principal!.id,'SUBMIT_REVIEW','SCENARIO',id);
    return {id,state:'UNDER_REVIEW'};
  });
  app.post('/api/v1/scenarios/:id/approve',async(req)=>{
    if(!canApprove(req.principal!))throw invalid('Approver permission required',403);
    const id=params(req),sc=await find(req,id);
    if(sc.state!=='UNDER_REVIEW'||sc.solver_status!=='COMPLETED')throw invalid('Scenario not ready for approval',409);
    const result=sc.result_snapshot;
    const readiness=assessReadiness(sc.input_snapshot,result,sc.solver_status);
    if(!readiness.technicalReady)
      throw invalid('Scenario has unresolved readiness blockers: '+readiness.issues.map(x=>x.code).join(', '),409);
    if(result.notices.some(n=>/hard=[-][1-9]/.test(n)))
      throw invalid('Hard constraint violations block approval',409);
    // Re-check exact immutable input/output. Optimized result has already passed validation in applySolverChoice.
    validateRequest(sc.input_snapshot);
    const saved=await pool.query(`UPDATE scenarios SET state='APPROVED',approved_by=$2,approved_at=now(),
      approved_snapshot=$3 WHERE id=$1 AND state='UNDER_REVIEW' RETURNING id`,[
      id,req.principal!.id,JSON.stringify({input:sc.input_snapshot,result,revision:sc.revision,policyRevision:sc.policy_revision})
    ]);
    if(!saved.rowCount)throw invalid('Concurrent approval state change',409);
    await audit(req.principal!.id,'APPROVE','SCENARIO',id);
    return {id,state:'APPROVED'};
  });
  app.post('/api/v1/scenarios/:id/reject',async(req)=>{
    if(!canApprove(req.principal!))throw invalid('Approver permission required',403);
    const id=params(req),sc=await find(req,id);
    if(sc.state!=='UNDER_REVIEW')throw invalid('Review state required',409);
    const note=z.object({reason:z.string().trim().min(4).max(1000)}).parse(req.body);
    await pool.query(`UPDATE scenarios SET state='REJECTED' WHERE id=$1 AND state='UNDER_REVIEW'`,[id]);
    await audit(req.principal!.id,'REJECT','SCENARIO',id,{reason:note.reason});
    return {id,state:'REJECTED'};
  });
  app.post('/api/v1/scenarios/:id/revise',async(req)=>{
    requireEditor(req);const id=params(req),sc=await find(req,id);
    const result=boundedDraft(sc.input_snapshot);
    const next=await pool.query<{id:string}>(`INSERT INTO scenarios
      (department_id,term_id,name,state,solver_status,input_snapshot,result_snapshot,created_by,revision,policy_revision)
      VALUES($1,$2,$3,'DRAFT','NOT_RUN',$4,$5,$6,$7,$8) RETURNING id`,[
      sc.department_id,sc.term_id,sc.name,JSON.stringify(sc.input_snapshot),JSON.stringify(result),
      req.principal!.id,sc.revision+1,sc.policy_revision
    ]);
    await audit(req.principal!.id,'REVISE','SCENARIO',next.rows[0]!.id,{parent:id});
    return {id:next.rows[0]!.id,state:'DRAFT',revision:sc.revision+1};
  });
  app.post('/api/v1/scenarios/:id/fork',async(req)=>{
    requireEditor(req);
    const id=params(req),sc=await find(req,id);
    const input=z.object({
      name:z.string().trim().min(1).max(160),
      overrides:z.array(z.object({
        code:z.string().min(1),
        demand:z.number().int().min(0).max(5000),
        blocks:z.array(z.string().trim().min(1).max(100)).max(250),
        blockSizes:z.array(z.number().int().positive().max(5000)).max(250).optional()
      }).strict()).max(250)
    }).strict().parse(req.body);
    const known=new Set(sc.input_snapshot.courses.map(c=>c.code));
    const seen=new Set<string>();
    for(const change of input.overrides){
      if(!known.has(change.code) || seen.has(change.code))
        throw invalid('Unknown or duplicate course override',400);
      seen.add(change.code);
      if(new Set(change.blocks).size!==change.blocks.length)
        throw invalid('Duplicate cohort block IDs are not permitted for one course',400);
    }
    const overrideMap=new Map(input.overrides.map(o=>[o.code,o]));
    const source:PlanRequest=structuredClone(sc.input_snapshot);
    source.scenarioName=input.name;
    source.courses=source.courses.map(c=>{
      const override=overrideMap.get(c.code);
      if(!override)return c;
      const changed=override.demand!==c.demand||
        JSON.stringify(override.blocks)!==JSON.stringify(c.blocks??[]);
      if(c.blockSizes && changed && !override.blockSizes)
        throw invalid('Provide explicit block sizes when changing a normalized cohort course',400);
      return {...c,demand:override.demand,blocks:override.blocks,
        blockSizes:override.blockSizes??c.blockSizes};
    });
    validateRequest(source);
    const result=boundedDraft(source);
    const next=await pool.query<{id:string}>(`INSERT INTO scenarios
      (department_id,term_id,name,state,solver_status,input_snapshot,result_snapshot,created_by,
       revision,policy_revision,parent_scenario_id)
      VALUES($1,$2,$3,'DRAFT','NOT_RUN',$4,$5,$6,1,$7,$8) RETURNING id`,[
      sc.department_id,sc.term_id,input.name,JSON.stringify(source),JSON.stringify(result),
      req.principal!.id,sc.policy_revision,sc.id
    ]);
    await audit(req.principal!.id,'FORK','SCENARIO',next.rows[0]!.id,{parent:id,overrides:input.overrides.length});
    return {id:next.rows[0]!.id,state:'DRAFT',parentScenarioId:id,result};
  });
  app.get('/api/v1/scenarios/:id/export.csv',async(req,reply)=>{
    const sc=await find(req,params(req));
    const state=sc.state==='APPROVED'?'APPROVED':'NOT_APPROVED';
    const header=['حالة الاعتماد','المقرر','الشعبة','المدرب','القاعة','النمط','اليوم','البداية','النهاية','البلوك'];
    const lines=[header.map(csvCell).join(',')];
    for(const s of sc.result_snapshot.sessions){
      lines.push([state,s.courseCode,s.sectionId,s.instructorId,s.roomId,s.mode,s.day,s.start,s.end,s.blockId].map(csvCell).join(','));
    }
    reply.header('content-type','text/csv; charset=utf-8');
    reply.header('content-disposition','attachment; filename="tps-schedule-'+state+'.csv"');
    return '\uFEFF'+lines.join('\r\n')+'\r\n';
  });
  app.get('/api/v1/scenarios/:id/print',async(req,reply)=>{
    const sc=await find(req,params(req));
    const readiness=assessReadiness(sc.input_snapshot,sc.result_snapshot,sc.solver_status);
    const html=renderPrintableScenario({name:sc.name,state:sc.state,termId:sc.term_id,
      policyRevision:sc.policy_revision,result:sc.result_snapshot,issues:readiness.issues});
    reply.header('Content-Type','text/html; charset=utf-8');
    reply.header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    reply.header('Cache-Control','private, no-store');
    return reply.send(html);
  });
  app.get('/api/v1/scenarios/:id/export.xlsx',async(req,reply)=>{
    const scenario=await find(req,params(req));
    const state=scenario.state==='APPROVED'?'APPROVED':'NOT_APPROVED';
    const readiness=assessReadiness(scenario.input_snapshot,scenario.result_snapshot,scenario.solver_status);
    const compareId=(req.query as {compareId?:string}).compareId;
    let comparisonRows:Array<[string,string|number,string|number]>|undefined;
    if(compareId){
      const other=await find(req,uuid.parse(compareId));
      if(other.id===scenario.id||other.department_id!==scenario.department_id||other.term_id!==scenario.term_id)
        throw invalid('Comparison requires a different scenario in the same department and term');
      const metrics=(v:Stored)=>({
        sections:v.result_snapshot.metrics.sectionCount,
        uncovered:v.result_snapshot.metrics.uncoveredSectionCount,
        requiredHours:v.result_snapshot.metrics.requiredContactHours,
        coveredHours:v.result_snapshot.metrics.assignedContactHours,
        load:v.result_snapshot.instructorLoads.reduce((n,i)=>n+i.credited,0)
      });
      const a=metrics(scenario),b=metrics(other);
      comparisonRows=[
        ['السيناريو',scenario.name,other.name],
        ['حالة الاعتماد',scenario.state,other.state],
        ['إصدار السياسة',scenario.policy_revision,other.policy_revision],
        ['الشعب',a.sections,b.sections],
        ['الشعب غير المغطاة',a.uncovered,b.uncovered],
        ['الساعات المطلوبة',a.requiredHours,b.requiredHours],
        ['الساعات المسندة',a.coveredHours,b.coveredHours],
        ['النصاب المكافئ',a.load,b.load]
      ];
    }
    const bytes=await exportScenarioXlsx(scenario.result_snapshot,{
      state,scenarioName:scenario.name,termId:scenario.term_id,policyRevision:scenario.policy_revision,
      readiness,comparisonRows
    });
    reply.header('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition','attachment; filename="tps-schedule-'+state+'.xlsx"');
    return reply.send(bytes);
  });
  app.get('/api/v1/scenarios/compare',async(req)=>{
    const ids=(req.query as {ids?:string}).ids?.split(',')??[];
    if(ids.length!==2)throw invalid('Provide exactly two scenario ids');
    const a=await find(req,uuid.parse(ids[0])),b=await find(req,uuid.parse(ids[1]));
    if(a.department_id!==b.department_id||a.term_id!==b.term_id)
      throw invalid('Scenarios must share department and term');
    const metric=(sc:Stored)=>({
      id:sc.id,name:sc.name,sections:sc.result_snapshot.metrics.sectionCount,
      uncovered:sc.result_snapshot.metrics.uncoveredSectionCount,
      requiredHours:sc.result_snapshot.metrics.requiredContactHours,
      coveredHours:sc.result_snapshot.metrics.assignedContactHours,
      coverage:sc.result_snapshot.metrics.requiredContactHours>0
        ?sc.result_snapshot.metrics.assignedContactHours/sc.result_snapshot.metrics.requiredContactHours:1,
      load:sc.result_snapshot.instructorLoads.reduce((x,y)=>x+y.credited,0),
      state:sc.state,solver:sc.solver_status
    });
    return {first:metric(a),second:metric(b)};
  });
}
