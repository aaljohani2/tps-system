#!/usr/bin/env node
/**
 * Dedicated local operational TPS environment.
 * The original .env and Docker volume are NEVER modified or deleted.
 * All normal runtime traffic uses a separate, fixed PostgreSQL database.
 */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const name='tps_operational_local';
const cmd=process.argv[2];

function guard(condition,message){if(!condition)throw new Error(message);}
function checkSettings(){
  const sourceName=process.env.TPS_DB_NAME;
  const user=process.env.TPS_DB_USER;
  guard(user&&/^[a-z][a-z0-9_]{1,62}$/.test(user),'TPS_DB_USER missing or invalid');
  guard(sourceName&&/^[a-z][a-z0-9_]{1,62}$/.test(sourceName),'TPS_DB_NAME missing or invalid in .env');
  guard(process.env.DATABASE_URL,'DATABASE_URL missing; load the existing .env');
  const url=new URL(process.env.DATABASE_URL);
  guard(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname==='127.0.0.1',
    'Local operational database must use loopback PostgreSQL');
  guard(decodeURIComponent(url.pathname.slice(1))===sourceName,
    'TPS_DB_NAME must match the DATABASE_URL database name; check your environment');
  guard(url.username&&url.password,'Configured DATABASE_URL requires existing local credentials');
  guard(process.env.HOST===undefined||['127.0.0.1','localhost'].includes(process.env.HOST),
    'Production mode cannot bind a network interface');
  guard(process.env.PORT===undefined||process.env.PORT==='8787',
    'Production mode uses only 127.0.0.1:8787');
  guard(sourceName!==name,
    'The existing .env must identify the original source DB, never the dedicated operational DB');
  const operational=new URL(url.toString());
  operational.pathname='/'+name;
  // Explicitly disable test and synthetic seed flags on the operational child.
  const env={...process.env,TPS_DB_NAME:name,DATABASE_URL:operational.toString(),
    TPS_RUNTIME_PROFILE:'LOCAL_PRODUCTION',HOST:'127.0.0.1',PORT:'8787'};
  delete env.TPS_DB_INTEGRATION;
  delete env.TPS_ALLOW_SYNTHETIC_SEED;
  delete env.TPS_E2E_SYNTHETIC;
  return {sourceName,user,env};
}
function commandRun(executable,args,{env=process.env,capture=false}={}){
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(executable,args,{cwd:root,env,windowsHide:true,
      stdio:capture?['ignore','pipe','pipe']:'inherit'});
    let output='',err='';
    if(capture){
      child.stdout.on('data',d=>{if(output.length<50000)output+=String(d);});
      child.stderr.on('data',d=>{if(err.length<2000)err+=String(d);});
    }
    child.on('error',e=>reject(new Error('Could not run '+executable+': '+e.message)));
    child.on('close',code=>code===0?resolvePromise(output.trim()):
      reject(new Error(executable+' failed (exit '+code+')'+
        (capture?' '+err.slice(0,1500):''))));
  });
}
async function docker(args,{capture=false}={}){
  return commandRun('docker',['compose',...args],{capture});
}
async function dbExists(user){
  const value=await docker(['exec','-T','postgres','psql','-X','-U',user,'-d','postgres',
    '-At','-c',`SELECT 1 FROM pg_database WHERE datname='${name}'`],{capture:true});
  guard(value===''||value==='1','Unexpected response when inspecting operational database');
  return value==='1';
}
function compiled(){
  guard(existsSync(resolve(root,'dist/src/api/server.js'))&&
    existsSync(resolve(root,'dist/src/api/migrate.js'))&&
    existsSync(resolve(root,'frontend/dist/index.html')),
    'Build files missing. Run npm run build and npm run web:build before local production');
}
async function init(settings){
  await docker(['up','-d','postgres']);
  if(!await dbExists(settings.user)){
    console.log('Creating NEW dedicated operational database (no synthetic test records).');
    await docker(['exec','-T','postgres','createdb','-U',settings.user,
      '--template','template0',name]);
  }else console.log('Existing operational database found: preserving all records.');
  compiled();
  await commandRun(process.execPath,['dist/src/api/migrate.js'],{env:settings.env});
  await commandRun(process.execPath,['dist/src/api/check.js'],{env:settings.env});
  console.log(JSON.stringify({state:'OPERATIONAL_DB_READY',database:name,
    seed:'never',originalDatabaseUntouched:settings.sourceName}));
}
async function check(settings){
  guard(await dbExists(settings.user),'Operational database does not exist; run init first');
  compiled();
  await commandRun(process.execPath,['dist/src/api/check.js'],{env:settings.env});
  console.log(JSON.stringify({state:'LOCAL_PRODUCTION_READY',database:name,
    expectedUrl:'http://127.0.0.1:8787',sourceTestDatabaseNotUsed:true}));
}
async function main(){
  guard(['init','check','bootstrap','start','backup','backup:verify','restore:test'].includes(cmd),
    'Usage: node --env-file=.env scripts/local-production.mjs init|check|bootstrap|start|backup|backup:verify|restore:test');
  const fileCommand=cmd==='backup:verify'||cmd==='restore:test';
  if(fileCommand)guard(process.argv.length===5&&process.argv[3]==='--file',
    'Verification/restoration requires --file <encrypted archive>');
  else guard(process.argv.length===3,'Unexpected extra arguments');
  const settings=checkSettings();
  if(cmd==='init')return init(settings);
  await check(settings);
  if(cmd==='backup'||fileCommand||cmd==='restore:test'){
    guard(process.env.TPS_BACKUP_PASSPHRASE?.length>=24,
      'Provide unique TPS_BACKUP_PASSPHRASE in the current shell; do not store in Git');
    const subcommand=cmd==='backup'?'backup':cmd==='backup:verify'?'verify':'restore-test';
    return commandRun(process.execPath,['scripts/backup-restore.mjs',subcommand,
      ...(fileCommand?process.argv.slice(3):[])],{env:settings.env});
  }
  if(cmd==='bootstrap'){
    guard(process.env.TPS_BOOTSTRAP_PASSWORD?.length>=16,
      'Set a private 16+ character TPS_BOOTSTRAP_PASSWORD in the current shell');
    // The existing bootstrap CLI refuses non-empty user tables.
    return commandRun(process.execPath,['dist/src/api/bootstrap.js'],{env:settings.env});
  }
  if(cmd==='start'){
    console.log('TPS local production: binding only http://127.0.0.1:8787');
    console.log('Source/testing databases remain untouched; no synthetic seed executed.');
    return commandRun(process.execPath,['dist/src/api/server.js'],{env:settings.env});
  }
}
main().catch(e=>{console.error('TPS operational startup blocked:',e.message);
  process.exitCode=1;});
