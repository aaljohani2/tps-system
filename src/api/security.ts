import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import argon2 from 'argon2';
import {z} from 'zod';
import {pool} from './database.js';

export interface Principal {
  id:string; role:string; collegeId:string|null; departmentId:string|null; username:string; csrf:string;
}
declare module 'fastify' { interface FastifyRequest { principal?:Principal } }
const COOKIE='tps_session';
const SESSION_SECONDS=60*60*8;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const same=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);};
export const canEdit=(p:Principal)=>['SYSTEM_ADMIN','COLLEGE_ADMIN','DEPARTMENT_HEAD','SCHEDULER'].includes(p.role);
export const canApprove=(p:Principal)=>['SYSTEM_ADMIN','COLLEGE_ADMIN','APPROVER'].includes(p.role);

export async function audit(userId:string|null, action:string,entityType:string,entityId:string|null,details:unknown={}):Promise<void>{
  await pool.query('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',[userId,action,entityType,entityId,JSON.stringify(details)]);
}
export async function allowedDepartment(p:Principal, departmentId:string):Promise<boolean>{
  if(p.role==='SYSTEM_ADMIN') return true;
  const d=await pool.query<{college_id:string}>('SELECT college_id FROM departments WHERE id=$1',[departmentId]);
  if(!d.rowCount) return false;
  if(p.departmentId && p.departmentId!==departmentId) return false;
  if(p.collegeId && p.collegeId!==d.rows[0]?.college_id) return false;
  return !!(p.collegeId || p.departmentId);
}
export async function allowedCollege(p:Principal,collegeId:string):Promise<boolean>{
  return p.role==='SYSTEM_ADMIN' || (!!p.collegeId && p.collegeId===collegeId);
}
export async function registerSecurity(app:FastifyInstance):Promise<void>{
  await app.register(cookie);
  await app.register(rateLimit,{global:false,max:10,timeWindow:'1 minute'});
  const credentials=z.object({username:z.string().trim().min(1).max(80),password:z.string().min(1).max(512)});
  app.post('/api/v1/auth/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
    const parsed=credentials.safeParse(req.body);
    if(!parsed.success) return reply.code(400).send({error:'Invalid credentials format'});
    const candidate=await pool.query<{id:string;username:string;password_hash:string;active:boolean}>(
      'SELECT id,username,password_hash,active FROM users WHERE username=$1',[parsed.data.username]);
    const u=candidate.rows[0];
    if(!u || !u.active || !await argon2.verify(u.password_hash,parsed.data.password).catch(()=>false))
      return reply.code(401).send({error:'Invalid username or password'});
    const raw=randomBytes(32).toString('base64url');
    const csrf=randomBytes(24).toString('base64url');
    await pool.query('INSERT INTO user_sessions(id_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval \'8 hours\')',[hash(raw),u.id,csrf]);
    reply.setCookie(COOKIE,raw,{path:'/',httpOnly:true,sameSite:'strict',secure:process.env.TPS_COOKIE_SECURE==='true',maxAge:SESSION_SECONDS});
    await audit(u.id,'LOGIN','USER',u.id);
    return {ok:true,username:u.username};
  });
  app.addHook('preHandler',async(req,reply)=>{
    if(req.url==='/health' || req.url.startsWith('/documentation') || req.url==='/api/v1/auth/login' || !req.url.startsWith('/api/v1/'))return;
    const raw=req.cookies[COOKIE];
    if(!raw) return reply.code(401).send({error:'Login required'});
    const result=await pool.query<{
      id:string;username:string;role:string;college_id:string|null;department_id:string|null;csrf_token:string
    }>(`SELECT u.id,u.username,u.role,u.college_id,u.department_id,s.csrf_token
      FROM user_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id_hash=$1 AND s.expires_at>now() AND u.active=true`,[hash(raw)]);
    const u=result.rows[0];
    if(!u) return reply.code(401).send({error:'Session expired'});
    req.principal={id:u.id,username:u.username,role:u.role,collegeId:u.college_id,departmentId:u.department_id,csrf:u.csrf_token};
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
      const header=req.headers['x-csrf-token'];
      if(typeof header!=='string'||!same(header,u.csrf_token))return reply.code(403).send({error:'CSRF token required'});
      const origin=req.headers.origin;
      if(origin){
        const host=req.headers.host;
        try { if(new URL(origin).host!==host) return reply.code(403).send({error:'Origin mismatch'}); }
        catch{return reply.code(403).send({error:'Invalid Origin'});}
      }
    }
  });
  app.get('/api/v1/auth/me',async(req)=>({id:req.principal!.id,username:req.principal!.username,
    role:req.principal!.role,collegeId:req.principal!.collegeId,departmentId:req.principal!.departmentId,csrfToken:req.principal!.csrf}));
  app.post('/api/v1/auth/logout',async(req,reply)=>{
    const raw=req.cookies[COOKIE];
    if(raw)await pool.query('DELETE FROM user_sessions WHERE id_hash=$1',[hash(raw)]);
    reply.clearCookie(COOKIE,{path:'/'});
    await audit(req.principal!.id,'LOGOUT','USER',req.principal!.id);
    return {ok:true};
  });
}
export function requireEditor(req:FastifyRequest):void{
  if(!req.principal||!canEdit(req.principal)){const e=new Error('Insufficient permissions') as Error&{statusCode:number};e.statusCode=403;throw e;}
}
