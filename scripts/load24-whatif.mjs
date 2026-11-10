#!/usr/bin/env node
/**
 * ONE-WAY, READ-ONLY WHAT-IF. Mathematical simulation of a temporary,
 * UNAPPROVED +2 teaching-hour allowance for trainer 6 (رمز 6).
 * Not an administrative approval. Cannot create a staged commit or write DB.
 */
import {URL} from 'node:url';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS=new Set(['BASE_157','CAP_100_50_40','CAP_120_40_ECO50']);
const args=process.argv.slice(2);
const get=(key)=>{const p=args.indexOf('--'+key);return p<0?undefined:args[p+1];};
const needed=(key)=>{const v=get(key);if(!v)throw Error('Missing --'+key);return v;};
function setupDb(){
 if(!process.env.DATABASE_URL)process.loadEnvFile('.env');
 const url=new URL(neededEnv('DATABASE_URL'));
 if(url.hostname!=='127.0.0.1')throw Error('Only local loopback PostgreSQL is supported');
 url.pathname='/tps_operational_local';url.search='';
 process.env.DATABASE_URL=url.href;
}
function neededEnv(key){if(!process.env[key])throw Error(key+' is required');return process.env[key];}
function parseIds(){
 const ids=needed('scenario-ids').split(',').map(id=>id.trim());
 if(ids.length!==3||new Set(ids).size!==3||ids.some(id=>!UUID.test(id)))
  throw Error('Exactly three distinct scenario UUIDs are required');
 return ids;
}
async function main(){
 if(get('confirm')!=='UNAPPROVED_SIMULATION_NO_SAVING')
  throw Error('This is an UNAPPROVED WHAT-IF. Require --confirm UNAPPROVED_SIMULATION_NO_SAVING');
 const department=needed('department-id');
 if(!UUID.test(department))throw Error('Invalid department UUID');
 const ids=parseIds();
 setupDb();
 // Only read from locally controlled TPS database. This script includes NO INSERT/UPDATE/DELETE.
 const {pool}=await import('../dist/src/api/database.js');
 const {makeUnapprovedMohammed24WhatIf}=await import('../dist/src/load24-whatif.js');
 const {optimizeWithTimefold}=await import('../dist/src/optimizer.js');
 const {verifyLoad24Result}=await import('../dist/src/load24-verification.js');
 let failures=0;
 try{
  const rows=(await pool.query(`SELECT id,department_id,term_id,state,solver_status,input_snapshot,result_snapshot
      FROM scenarios WHERE department_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,
      [department,ids])).rows;
  if(rows.length!==3)throw Error('One or more selected scenarios is not in the department');
  const keys=new Set(),terms=new Set();
  for(const row of rows){
   const key=row.input_snapshot?.projection?.key;
   if(row.state!=='DRAFT'||row.solver_status!=='COMPLETED')
    throw Error('Only completed DRAFT source scenarios may be simulated');
   if(!KEYS.has(key)||keys.has(key))throw Error('Three distinct projected profiles are required');
   if(row.input_snapshot.termId!==row.term_id)throw Error('Stored term/source mismatch');
   if(row.input_snapshot.instructors.length!==6||
     !['1','2','3','4','5','6'].every(id=>row.input_snapshot.instructors.some(x=>x.id===id)))
    throw Error('Only verified six-instructor departmental snapshots are supported');
   keys.add(key);terms.add(row.term_id);
  }
  if(keys.size!==3||terms.size!==1)throw Error('All three profiles must be from the same term');
  console.log('HYPOTHETICAL_ONLY — trainer 6 original maxLoad=22; temporary simulated effective limit=24.');
  console.log('NO official exception, NO operational updates, NO prepared stage, NO approvals.');
  for(const row of rows.sort((a,b)=>a.input_snapshot.projection.key.localeCompare(b.input_snapshot.projection.key))){
   const key=row.input_snapshot.projection.key;
   const baseline=Object.fromEntries(row.result_snapshot.instructorLoads.map(x=>[x.id,x.credited]));
   let prepared;
   try{prepared=makeUnapprovedMohammed24WhatIf(row.input_snapshot);}
   catch(e){failures++;console.log(JSON.stringify({key,status:'FAILED_PRECHECK',reason:String(e.message)}));continue;}
   const {simulationSource,input}=prepared;
   let result,verified,latestReason='not solved';
   for(const seconds of [15,30]){
    try{
     result=await optimizeWithTimefold(input,{seconds,candidatesPerInstructor:24});
     // Validate actual split/demand/membership changes against the hypothetical
     // pre-split source, not against the already-modified input itself.
     verified=verifyLoad24Result(simulationSource,row.result_snapshot,input,result);
     break;
    }catch(e){latestReason=String(e instanceof Error?e.message:e);}
   }
   if(verified){
    console.log(JSON.stringify({key,status:'TECHNICALLY_FEASIBLE_UNAPPROVED',baselineLoads:baseline,
      proposedLoads:Object.fromEntries(result.instructorLoads.map(x=>[x.id,x.credited])),
      gaps:verified.gaps,scheduled:verified.scheduled,sections:verified.sections,hard:verified.score.hard,
      missingAdministrativeAuthorizationForTrainer6:2}));
   }else{
    failures++;
    console.log(JSON.stringify({key,status:'NOT_PROVEN',baselineLoads:baseline,
      trialLoads:result?Object.fromEntries(result.instructorLoads.map(x=>[x.id,x.credited])):null,
      trialGaps:result?.gaps.length??null,reason:latestReason}));
   }
  }
 }finally{await pool.end();}
 console.log('READ_ONLY_HYPOTHETICAL_COMPLETE: Nothing was saved. Original trainer 6 maximum remains 22.');
 if(failures)process.exitCode=2;
}
main().catch(e=>{console.error('WHATIF_STOP_NO_DATABASE_WRITES:',e instanceof Error?e.message:String(e));process.exitCode=1;});
