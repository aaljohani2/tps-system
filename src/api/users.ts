import argon2 from 'argon2';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {pool} from './database.js';
import {audit} from './security.js';

const uuid=z.string().uuid();
const roles=z.enum(['SYSTEM_ADMIN','COLLEGE_ADMIN','DEPARTMENT_HEAD','SCHEDULER','REVIEWER','APPROVER','TRAINER','VIEWER']);
const forbidden=()=>{throw Object.assign(new Error('Administrator permission required'),{statusCode:403});};
const invalid=(text:string,statusCode=400)=>Object.assign(new Error(text),{statusCode});
function admin(req:FastifyRequest){
  if(!req.principal||!['SYSTEM_ADMIN','COLLEGE_ADMIN'].includes(req.principal.role))forbidden();
  return req.principal!;
}
async function validScope(p:ReturnType<typeof admin>,role:string,collegeId:string|null,departmentId:string|null){
  if(role==='SYSTEM_ADMIN'){
    if(p.role!=='SYSTEM_ADMIN'||collegeId||departmentId)forbidden();
    return;
  }
  if(!collegeId)throw invalid('College scope is required');
  if(p.role==='COLLEGE_ADMIN' && (role==='COLLEGE_ADMIN'||collegeId!==p.collegeId))forbidden();
  if(departmentId){
    const r=await pool.query<{college_id:string}>('SELECT college_id FROM departments WHERE id=$1',[departmentId]);
    if(!r.rows[0]||r.rows[0].college_id!==collegeId)throw invalid('Department does not belong to selected college');
  }
}
export async function registerUsers(app:FastifyInstance){
  app.get('/api/v1/users',async(req)=>{
    const p=admin(req);
    const rows=await pool.query(`SELECT id,username,role,college_id,department_id,active,created_at
      FROM users WHERE ($1='SYSTEM_ADMIN' OR college_id=$2) ORDER BY username LIMIT 500`,
      [p.role,p.collegeId]);
    return rows.rows;
  });
  app.post('/api/v1/users',async(req)=>{
    const p=admin(req);
    const v=z.object({username:z.string().trim().min(3).max(80),password:z.string().min(16).max(128),
      role:roles,collegeId:uuid.nullable(),departmentId:uuid.nullable().default(null)}).strict().parse(req.body);
    await validScope(p,v.role,v.collegeId,v.departmentId);
    const hash=await argon2.hash(v.password,{type:argon2.argon2id});
    const row=await pool.query<{id:string;username:string;role:string;active:boolean}>(
      'INSERT INTO users(username,password_hash,role,college_id,department_id) VALUES($1,$2,$3,$4,$5) RETURNING id,username,role,active',
      [v.username,hash,v.role,v.collegeId,v.departmentId]);
    await audit(p.id,'CREATE','USER',row.rows[0]!.id,{role:v.role,collegeId:v.collegeId,departmentId:v.departmentId});
    return row.rows[0];
  });
  app.patch('/api/v1/users/:id',async(req)=>{
    const p=admin(req);
    const id=uuid.parse((req.params as {id:string}).id);
    const v=z.object({active:z.boolean().optional(),role:roles.optional(),
      collegeId:uuid.nullable().optional(),departmentId:uuid.nullable().optional()}).strict().parse(req.body);
    if(!Object.keys(v).length)throw invalid('No changes supplied');
    const existing=await pool.query<{role:string;college_id:string|null;department_id:string|null;active:boolean}>(
      'SELECT role,college_id,department_id,active FROM users WHERE id=$1',[id]);
    if(!existing.rows[0])throw invalid('User not found',404);
    const prior=existing.rows[0];
    if(p.role==='COLLEGE_ADMIN' && (prior.role==='SYSTEM_ADMIN'||prior.role==='COLLEGE_ADMIN'||prior.college_id!==p.collegeId))forbidden();
    if(id===p.id && (v.active===false||v.role && v.role!==prior.role))throw invalid('Cannot disable or reassign own active administrator account',409);
    const role=v.role??prior.role,college=v.collegeId===undefined?prior.college_id:v.collegeId;
    const department=v.departmentId===undefined?prior.department_id:v.departmentId;
    await validScope(p,role,college,department);
    if(prior.role==='SYSTEM_ADMIN' && (v.active===false || role!=='SYSTEM_ADMIN')){
      const count=await pool.query<{n:string}>("SELECT count(*)::text AS n FROM users WHERE role='SYSTEM_ADMIN' AND active=true");
      if(Number(count.rows[0]!.n)<=1)throw invalid('Cannot remove the last active system administrator',409);
    }
    const changed=await pool.query(`UPDATE users SET role=$2,active=$3,college_id=$4,department_id=$5
      WHERE id=$1 RETURNING id,username,role,college_id,department_id,active`,
      [id,role,v.active??prior.active,college,department]);
    if(v.active===false||v.role||v.collegeId!==undefined||v.departmentId!==undefined)
      await pool.query('DELETE FROM user_sessions WHERE user_id=$1',[id]);
    await audit(p.id,'UPDATE','USER',id,{fields:Object.keys(v)});
    return changed.rows[0];
  });
  app.put('/api/v1/users/:id/password',async(req)=>{
    const p=admin(req);
    const id=uuid.parse((req.params as {id:string}).id);
    const v=z.object({newPassword:z.string().min(16).max(128)}).strict().parse(req.body);
    const target=await pool.query<{role:string;college_id:string|null}>('SELECT role,college_id FROM users WHERE id=$1',[id]);
    if(!target.rows[0])throw invalid('User not found',404);
    if(p.role==='COLLEGE_ADMIN' && (target.rows[0].role==='SYSTEM_ADMIN'||
      target.rows[0].role==='COLLEGE_ADMIN'||target.rows[0].college_id!==p.collegeId))forbidden();
    const hash=await argon2.hash(v.newPassword,{type:argon2.argon2id});
    await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1',[id,hash]);
    await pool.query('DELETE FROM user_sessions WHERE user_id=$1',[id]);
    await audit(p.id,'PASSWORD_RESET','USER',id);
    return {ok:true};
  });
}
