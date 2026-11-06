import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {pool} from './database.js';
import {audit,allowedDepartment,canApprove,requireEditor} from './security.js';
import {defaultPolicy} from '../policy.js';
import {buildDraftPlan} from '../planner.js';
import {optimizeWithTimefold} from '../optimizer.js';
import {validateRequest} from '../validation.js';
import {exportScenarioXlsx} from './excel.js';
import {getEffectivePolicy} from './policies.js';
import {assessReadiness} from './readiness.js';
import type {Course,Instructor,PlanRequest,PlanResult,Policy,Room} from '../types.js';

const uuid=z.string().uuid();
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
    const q=req.query as {departmentId?:string;termId?:string};
    const departmentId=uuid.parse(q.departmentId);
    await scope(req,departmentId);
    const termId=q.termId?uuid.parse(q.termId):null;
    const rows=await pool.query(`SELECT id,department_id,term_id,name,state,solver_status,revision,policy_revision,parent_scenario_id,created_at,approved_at
      FROM scenarios WHERE department_id=$1 AND ($2::uuid IS NULL OR term_id=$2)
      ORDER BY created_at DESC LIMIT 100`,[departmentId,termId]);
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
  app.post('/api/v1/scenarios/:id/solve',async(req)=>{
    requireEditor(req);
    const id=params(req),sc=await find(req,id);
    if(sc.state!=='DRAFT')throw invalid('Only a DRAFT may be solved',409);
    // Claim the scenario atomically. Duplicate requests must not start parallel Java solvers.
    const claim=await pool.query(`UPDATE scenarios SET solver_status='RUNNING'
      WHERE id=$1 AND state='DRAFT' AND solver_status IN ('NOT_RUN','FAILED')
      RETURNING id`,[id]);
    if(!claim.rowCount)throw invalid('Solver already running or scenario already solved',409);
    try {
      validateRequest(sc.input_snapshot);
      const result=await optimizeWithTimefold(sc.input_snapshot);
      const saved=await pool.query(`UPDATE scenarios SET result_snapshot=$2,solver_status='COMPLETED',
        solver_details=$3 WHERE id=$1 AND state='DRAFT' AND solver_status='RUNNING' RETURNING id`,[
        id,JSON.stringify(result),JSON.stringify({mode:'Timefold',at:new Date().toISOString()})
      ]);
      if(!saved.rowCount)throw invalid('Scenario state changed while solving',409);
      await audit(req.principal!.id,'SOLVE','SCENARIO',id,{gaps:result.gaps.length});
      return {id,result,solverStatus:'COMPLETED'};
    } catch(e){
      await pool.query(`UPDATE scenarios SET solver_status='FAILED'
        WHERE id=$1 AND state='DRAFT' AND solver_status='RUNNING'`,[id]);
      throw e;
    }
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
  app.get('/api/v1/scenarios/:id/export.xlsx',async(req,reply)=>{
    const scenario=await find(req,params(req));
    const state=scenario.state==='APPROVED'?'APPROVED':'NOT_APPROVED';
    const bytes=await exportScenarioXlsx(scenario.result_snapshot,{
      state,scenarioName:scenario.name,termId:scenario.term_id,policyRevision:scenario.policy_revision
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
