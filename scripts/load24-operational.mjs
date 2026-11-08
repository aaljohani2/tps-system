#!/usr/bin/env node
/**
 * Operator-only local workflow. LIST and PREPARE never mutate PostgreSQL.
 * COMMIT creates new linked DRAFT scenarios; it never overwrites the sources.
 * Private stage snapshots and passwords must never be committed or uploaded.
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,sep} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_SET=new Set(['BASE_157','CAP_100_50_40','CAP_120_40_ECO50']);
const HASH=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const args=process.argv.slice(2),action=args.shift();
const opt=name=>{const at=args.indexOf('--'+name);return at<0?undefined:args[at+1];};
const must=(value,name)=>{if(!value)throw Error('Missing --'+name);return value;};
const uuid=(value,name)=>{if(!UUID.test(value??''))throw Error('Invalid '+name);return value;};
const verifyLocal=()=>{
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing from local .env');
 const url=new URL(process.env.DATABASE_URL);
 if(url.hostname!=='127.0.0.1')throw Error('Only localhost 127.0.0.1 PostgreSQL is allowed');
 // Pin the operational DB before importing the pool; never use the development DB.
 url.pathname='/tps_operational_local';url.search='';
 process.env.DATABASE_URL=url.href;
};
const snapshotHash=row=>({input:HASH(row.input_snapshot),result:HASH(row.result_snapshot)});
const note=(...chunks)=>console.log(...chunks);
const safelyDescribe=row=>({id:row.id,key:row.input_snapshot?.projection?.key??'REFERENCE',
 state:row.state,solver:row.solver_status,revision:row.revision,policyRevision:row.policy_revision});
const selectedIds=()=>{
 const ids=must(opt('scenario-ids'),'scenario-ids').split(',').map(x=>uuid(x.trim(),'scenario-id'));
 if(ids.length!==3||new Set(ids).size!==3)throw Error('Exactly three distinct scenario IDs are mandatory');
 return ids;
};
async function requireOriginals(db,department,ids,locking=false){
 const rows=(await db.query(`SELECT id,department_id,term_id,name,state,solver_status,revision,
  policy_revision,input_snapshot,result_snapshot FROM scenarios
  WHERE department_id=$1 AND id=ANY($2::uuid[]) ORDER BY id ${locking?'FOR UPDATE':''}`,
  [department,ids])).rows;
 if(rows.length!==3)throw Error('Three selected scenarios are not in the chosen department');
 const keys=new Set(),terms=new Set();
 for(const row of rows){
  if(row.state!=='DRAFT'||row.solver_status!=='COMPLETED')throw Error('A selected source is not a completed DRAFT: '+row.id);
  const key=row.input_snapshot?.projection?.key;
  if(!KEY_SET.has(key)||keys.has(key))throw Error('Missing or duplicate projection profile');
  if(row.term_id!==row.input_snapshot.termId)throw Error('Term ID differs from input snapshot');
  keys.add(key);terms.add(row.term_id);
 }
 if(keys.size!==3||terms.size!==1)throw Error('Selected projections must be all three profiles in one term');
 return rows.sort((a,b)=>a.input_snapshot.projection.key.localeCompare(b.input_snapshot.projection.key));
}
async function verifyBackup(){
 const file=resolve(must(opt('backup-file'),'backup-file'));
 const parent=resolve('private-data/backups')+sep;
 if(!file.startsWith(parent)||!file.endsWith('.tpsbak'))throw Error('Backup must be an encrypted .tpsbak under private-data/backups');
 if((await stat(file)).size<500)throw Error('Operational backup file is unexpectedly small');
 if(!process.env.TPS_BACKUP_PASSPHRASE)throw Error('Set TPS_BACKUP_PASSPHRASE locally to verify an encrypted backup');
 const check=spawnSync(process.execPath,['scripts/backup-restore.mjs','verify','--file',file],{
  cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
 if(check.error||check.status!==0)throw Error('Encrypted backup integrity verification failed: '+String(check.error?.message??check.stderr).slice(0,400));
 note('Encrypted operational backup verified locally.');
}
async function main(){
 if(!['list','diagnose','prepare','commit'].includes(action))
  throw Error('Usage: node scripts/load24-operational.mjs list|diagnose|prepare|commit --department-id UUID [...]');
 if(!process.env.DATABASE_URL)process.loadEnvFile('.env');
 verifyLocal();
 const department=uuid(must(opt('department-id'),'department-id'),'department-id');
 const {pool}=await import('../dist/src/api/database.js');
 try{
  if(action==='list'){
   const rows=(await pool.query(`SELECT id,department_id,term_id,name,state,solver_status,revision,policy_revision,input_snapshot
     FROM scenarios WHERE department_id=$1 ORDER BY created_at DESC,id DESC`,[department])).rows;
   note(JSON.stringify(rows.map(safelyDescribe),null,2));return;
  }
  if(action==='diagnose'){
   const ids=selectedIds(),rows=await requireOriginals(pool,department,ids);
   const {diagnoseLoad24Capacity}=await import('../dist/src/load24-diagnostics.js');
   const output=[];
   for(const row of rows){
    const raw=(await pool.query(`SELECT i.code,i.name,i.max_load,
      COALESCE(e.additional_hours,0) AS approved_exception_hours
      FROM instructors i
      LEFT JOIN instructor_load_exceptions e
       ON e.instructor_id=i.id AND e.term_id=$2 AND e.state='APPROVED'
      WHERE i.department_id=$1 ORDER BY i.code`,[department,row.term_id])).rows;
    const current=raw.map(item=>({
     code:item.code,name:item.name,maxLoad:Number(item.max_load),
     approvedExceptionHours:Number(item.approved_exception_hours)
    }));
    output.push({scenario:row.input_snapshot.projection?.key,scenarioId:row.id,
      trainers:diagnoseLoad24Capacity(row.input_snapshot,row.result_snapshot,current)});
   }
   note('READ_ONLY_CAPACITY_DIAGNOSIS: '+JSON.stringify(output,null,2));
   note('No scenario, instructor master, exception, or policy was modified.');
   return;
  }
  if(action==='prepare'){
   const ids=selectedIds(),rows=await requireOriginals(pool,department,ids);
   const {splitTeachingSections}=await import('../dist/src/load-targets.js');
   const {prepareLoad24Input,verifyLoad24Result}=await import('../dist/src/load24-verification.js');
   const {optimizeWithTimefold}=await import('../dist/src/optimizer.js');
   const stage=[];
   for(const row of rows){
    const roster=row.input_snapshot.instructors;
    if(roster.length!==6||!['1','2','3','4','5','6'].every(code=>roster.some(i=>i.id===code)))
     throw Error('Expected exactly the six verified trainer codes in '+row.id);
    const targetNames=['5','6'].map(code=>roster.find(i=>i.id===code).name);
    if(!targetNames.some(name=>name.includes('محمد'))||!targetNames.some(name=>name.includes('فهد')))
     throw Error('Trainer code 5/6 mapping does not identify both محمد and فهد; stop and verify identities locally');
    const input=prepareLoad24Input(row.input_snapshot,splitTeachingSections);
    let result,settings,verified,solveStart,solveEnd,elapsedMs;
    for(const seconds of [15,30]){
     settings={seconds,candidatesPerInstructor:24};
     solveStart=new Date().toISOString();const started=Date.now();
     result=await optimizeWithTimefold(input,settings);
     elapsedMs=Date.now()-started;solveEnd=new Date().toISOString();
     try{verified=verifyLoad24Result(row.input_snapshot,row.result_snapshot,input,result);break;}
     catch(e){note('Scenario '+input.projection.key+' failed '+seconds+'-second strict gate: '+String(e.message));}
    }
    if(!verified)throw Error('STOP: load24 is not feasible or proven for '+input.projection.key+'; no changes saved');
    stage.push({sourceId:row.id,departmentId:row.department_id,termId:row.term_id,
     sourceName:row.name,revision:row.revision,policyRevision:row.policy_revision,expected:snapshotHash(row),
     sourceInput:row.input_snapshot,priorResult:row.result_snapshot,
     input,result,settings,verified,solveStart,solveEnd,elapsedMs});
    note('PASSED '+JSON.stringify(verified));
   }
   const file=resolve('private-data/load24','load24-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)+'.json');
   await mkdir(resolve('private-data/load24'),{recursive:true});
   await writeFile(file,JSON.stringify({version:1,createdAt:new Date().toISOString(),departmentId:department,stage},null,2),{flag:'wx',mode:0o600});
   note('PREPARED_ONLY: '+file);
   note('Sources unchanged. Review the local private stage and verified backup before any explicit commit.');
   return;
  }
  if(opt('confirm')!=='COMMIT_THREE_REVIEW_DRAFTS')
   throw Error('commit requires --confirm COMMIT_THREE_REVIEW_DRAFTS');
  const actor=uuid(must(opt('actor-id'),'actor-id'),'actor-id');
  const file=resolve(must(opt('stage-file'),'stage-file'));
  if(!file.startsWith(resolve('private-data/load24')+sep))throw Error('Stage must stay under private-data/load24');
  const receipt=JSON.parse(await readFile(file,'utf8'));
  if(receipt.version!==1||receipt.departmentId!==department||!Array.isArray(receipt.stage)||receipt.stage.length!==3)
   throw Error('Invalid private load24 stage');
  if(Date.now()-new Date(receipt.createdAt).getTime()>48*3600000||
    !Number.isFinite(new Date(receipt.createdAt).getTime()))throw Error('Stage expired; prepare it again');
  const ids=receipt.stage.map(x=>uuid(x.sourceId,'sourceId'));
  if(new Set(ids).size!==3)throw Error('Duplicated stage source');
  const {verifyLoad24Result}=await import('../dist/src/load24-verification.js');
  for(const item of receipt.stage){
   if(item.departmentId!==department||!KEY_SET.has(item.input?.projection?.key))throw Error('Invalid staged scope');
   const reverified=verifyLoad24Result(item.sourceInput,item.priorResult,item.input,item.result);
   if(JSON.stringify(reverified)!==JSON.stringify(item.verified))throw Error('Staged calculation changed');
  }
  await verifyBackup();
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // Serialize across operators; source-row locks guard against concurrent editing.
   await client.query('SELECT pg_advisory_xact_lock(4471729)');
   const rows=await requireOriginals(client,department,ids,true);
   const user=(await client.query(`SELECT u.id,u.role,u.active,u.department_id,u.college_id,d.college_id AS selected_college
    FROM users u JOIN departments d ON d.id=$2 WHERE u.id=$1`,[actor,department])).rows[0];
   if(!user?.active||!['SYSTEM_ADMIN','COLLEGE_ADMIN','DEPARTMENT_HEAD','SCHEDULER'].includes(user.role)||
     (user.role!=='SYSTEM_ADMIN'&&!user.department_id&&!user.college_id)||
     (user.department_id&&user.department_id!==department)||
     (user.college_id&&user.college_id!==user.selected_college))
    throw Error('Actor is not authorized to create drafts in this department');
   const created=[];
   for(const row of rows){
    const item=receipt.stage.find(s=>s.sourceId===row.id);
    if(!item||item.termId!==row.term_id||item.revision!==row.revision||
      item.policyRevision!==row.policy_revision||
      item.expected.input!==snapshotHash(row).input||item.expected.result!==snapshotHash(row).result)
     throw Error('Source changed since preparation: '+row.id);
    const name=(row.name+' — مراجعة نصاب 24').slice(0,160);
    const existing=await client.query(`SELECT id FROM scenarios WHERE parent_scenario_id=$1 AND name=$2
      AND state IN ('DRAFT','UNDER_REVIEW','APPROVED')`,[row.id,name]);
    if(existing.rowCount)throw Error('Review draft already exists for this source: '+row.id);
    const id=randomUUID(),runId=randomUUID(),score=item.verified.score;
    await client.query(`INSERT INTO scenarios
      (id,department_id,term_id,name,state,solver_status,input_snapshot,result_snapshot,
       solver_details,created_by,revision,policy_revision,parent_scenario_id)
      VALUES ($1,$2,$3,$4,'DRAFT','COMPLETED',$5::jsonb,$6::jsonb,$7::jsonb,$8,1,$9,$10)`,
      [id,row.department_id,row.term_id,name,JSON.stringify(item.input),JSON.stringify(item.result),
       JSON.stringify({mode:'Timefold',runId,score,settings:item.settings,at:item.solveEnd,elapsedMs:item.elapsedMs,
        sourceId:row.id,offlineStaged:true,gate:'load24-verified'}),actor,row.policy_revision,row.id]);
    await client.query(`INSERT INTO solver_runs
       (id,scenario_id,requested_by,status,started_at,finished_at,elapsed_ms,result_metrics,score,progress_stage,progress_at,requested_settings)
       VALUES ($1,$2,$3,'COMPLETED',$7::timestamptz,$8::timestamptz,$9,$4::jsonb,$5::jsonb,'COMPLETED',now(),$6::jsonb)`,
       [runId,id,actor,JSON.stringify(item.result.metrics),JSON.stringify(score),JSON.stringify(item.settings),
        item.solveStart,item.solveEnd,item.elapsedMs]);
    await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
       VALUES($1,'CREATE_LOAD24_REVIEW','SCENARIO',$2,$3::jsonb)`,
       [actor,id,JSON.stringify({parentId:row.id,sourceInputHash:item.expected.input,key:item.verified.key,targetHours:24,backupVerified:true})]);
    created.push({key:item.verified.key,id,sourceId:row.id});
   }
   await client.query('COMMIT');
   note('COMMITTED_REVIEW_DRAFTS: '+JSON.stringify(created,null,2));
   note('Original scenarios remain intact; all created scenarios remain DRAFT, not approved.');
  }catch(e){await client.query('ROLLBACK');throw e;}
  finally{client.release();}
 }finally{await pool.end();}
}
main().catch(error=>{console.error('STOP_NO_UNVERIFIED_WRITE:',error.message);process.exitCode=1;});
