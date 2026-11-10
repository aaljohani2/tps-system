import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {pool} from './database.js';
import {audit,allowedDepartment,canApprove,requireEditor} from './security.js';
import {defaultPolicy} from '../policy.js';
import {validateRequest} from '../validation.js';
import type {Policy} from '../types.js';

const id=z.string().uuid();
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const scope=z.object({departmentId:id,termId:id});
const mode=z.enum(['ONSITE','REMOTE','SELF_PACED','HYBRID']);
const day=z.enum(['SUN','MON','TUE','WED','THU']);
const policySchema=z.object({
  enabledModes:z.array(mode).min(1).max(4).refine(v=>new Set(v).size===v.length,'Duplicate mode'),
  capacities:z.object({
    ONSITE:z.object({theory:z.number().int().positive(),practical:z.number().int().positive()}),
    REMOTE:z.object({theory:z.number().int().positive(),practical:z.number().int().positive()}),
    SELF_PACED:z.object({theory:z.null(),practical:z.null()}),
    HYBRID:z.object({theory:z.number().int().positive(),practical:z.number().int().positive()})
  }).strict(),
  remotePracticalLoadFactor:z.number().positive().max(4),
  onsitePracticalLoadFactor:z.number().positive().max(4),
  selfPacedLoadPerOffering:z.number().nonnegative().max(100).nullable(),
  slots:z.array(z.object({day,from:z.number().multipleOf(0.5).min(0).max(23.5),to:z.number().multipleOf(0.5).min(0.5).max(24)})
    .refine(w=>w.to>w.from,'Invalid time window')).min(1).max(40),
  sessionMaxHours:z.number().int().min(1).max(8)
}).strict();
export interface PolicyRecord{
  department_id:string;term_id:string;draft_policy:Policy;approved_policy:Policy|null;
  draft_revision:number;approved_revision:number;rationale:string|null;
  approved_at:string|null;updated_at:string;
}
export async function verifyScope(req:FastifyRequest,departmentId:string,termId:string):Promise<void>{
  if(!await allowedDepartment(req.principal!,departmentId))throw fail('Scope denied',403);
  const rows=await pool.query('SELECT 1 FROM departments d JOIN academic_terms t ON t.college_id=d.college_id WHERE d.id=$1 AND t.id=$2',[departmentId,termId]);
  if(!rows.rowCount)throw fail('Department and training term belong to different colleges',400);
}
export async function getEffectivePolicy(departmentId:string,termId:string):Promise<{policy:Policy;revision:number}>{
  const r=await pool.query<{approved_policy:Policy|null;approved_revision:number}>(
    'SELECT approved_policy,approved_revision FROM planning_policies WHERE department_id=$1 AND term_id=$2',
    [departmentId,termId]);
  const record=r.rows[0];
  return {policy:record?.approved_policy??defaultPolicy(),revision:record?.approved_policy?record.approved_revision:0};
}
function validatePolicy(policy:Policy):void{
  validateRequest({scenarioName:'Policy validation',termId:'test',courses:[],instructors:[],rooms:[],policy});
}
export async function registerPolicies(app:FastifyInstance):Promise<void>{
  app.get('/api/v1/policies',async(req)=>{
    const {departmentId,termId}=scope.parse(req.query);
    await verifyScope(req,departmentId,termId);
    const r=await pool.query<PolicyRecord>('SELECT * FROM planning_policies WHERE department_id=$1 AND term_id=$2',[departmentId,termId]);
    const saved=r.rows[0];
    const effective=saved?.approved_policy??defaultPolicy();
    return {effectivePolicy:effective,approvedRevision:saved?.approved_policy?saved.approved_revision:0,
      draftPolicy:saved?.draft_policy??effective,draftRevision:saved?.draft_revision??0,
      pending:!!saved && saved.draft_revision>saved.approved_revision,
      updatedAt:saved?.updated_at??null,approvedAt:saved?.approved_at??null};
  });
  app.put('/api/v1/policies',async(req)=>{
    requireEditor(req);
    const v=z.object({departmentId:id,termId:id,policy:policySchema,rationale:z.string().trim().min(8).max(1200)}).strict().parse(req.body);
    await verifyScope(req,v.departmentId,v.termId);
    validatePolicy(v.policy as Policy);
    const saved=await pool.query<PolicyRecord>(
      `INSERT INTO planning_policies(department_id,term_id,draft_policy,rationale,updated_by)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (department_id,term_id) DO UPDATE SET draft_policy=EXCLUDED.draft_policy,
       draft_revision=planning_policies.draft_revision+1,rationale=EXCLUDED.rationale,
       updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
      [v.departmentId,v.termId,JSON.stringify(v.policy),v.rationale,req.principal!.id]);
    await audit(req.principal!.id,'POLICY_DRAFT','PLANNING_POLICY',v.departmentId,{termId:v.termId,revision:saved.rows[0]!.draft_revision});
    return {draftRevision:saved.rows[0]!.draft_revision,pending:true};
  });
  app.post('/api/v1/policies/approve',async(req)=>{
    if(!canApprove(req.principal!))throw fail('Approver role required',403);
    const v=scope.parse(req.body);
    await verifyScope(req,v.departmentId,v.termId);
    const r=await pool.query<PolicyRecord>(`UPDATE planning_policies SET
      approved_policy=draft_policy,approved_revision=draft_revision,
      approved_at=now(),approved_by=$3
      WHERE department_id=$1 AND term_id=$2 AND draft_revision>approved_revision RETURNING *`,
      [v.departmentId,v.termId,req.principal!.id]);
    if(!r.rowCount)throw fail('No pending policy revision to approve',409);
    await audit(req.principal!.id,'POLICY_APPROVE','PLANNING_POLICY',v.departmentId,
      {termId:v.termId,revision:r.rows[0]!.approved_revision});
    return {approvedRevision:r.rows[0]!.approved_revision};
  });
}
