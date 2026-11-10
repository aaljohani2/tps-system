#!/usr/bin/env node
/**
 * TPS PostgreSQL encrypted backup + isolated restore drill.
 * Local Docker Compose only; there is deliberately NO restore-to-source option.
 * Backup file: magic(8) | salt(16) | iv(12) | AES-256-GCM ciphertext | tag(16).
 */
import {spawn} from 'node:child_process';
import {createCipheriv,createDecipheriv,randomBytes,scryptSync} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,open,stat,rename,rm,realpath} from 'node:fs/promises';
import {join,resolve,dirname,basename,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline,finished} from 'node:stream/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const backupDir=join(root,'private-data','backups');
const magic=Buffer.from('TPSBKP1\n','ascii');
const HEADER_SIZE=8+16+12;
const TAG_SIZE=16;
const command=process.argv[2];
const db=process.env.TPS_DB_NAME;
const user=process.env.TPS_DB_USER;
const passphrase=process.env.TPS_BACKUP_PASSPHRASE;

function invariant(value,message){if(!value)throw new Error(message);}
function checkConfig(){
  invariant(db&&/^[a-z][a-z0-9_]{1,62}$/.test(db),'Set a safe TPS_DB_NAME in local .env');
  invariant(user&&/^[a-z][a-z0-9_]{1,62}$/.test(user),'Set a safe TPS_DB_USER in local .env');
  invariant(passphrase&&passphrase.length>=24&&Buffer.byteLength(passphrase,'utf8')<=4096,
    'Set a unique TPS_BACKUP_PASSPHRASE (24+ characters) in this shell; do not save it in Git');
}
function docker(args,{stream=false}={}){
  const child=spawn('docker',['compose','exec','-T','postgres',...args],{
    cwd:root,env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']
  });
  const errors=[];
  child.stderr.on('data',chunk=>{
    if(errors.join('').length<4096)errors.push(String(chunk).slice(0,1024));
  });
  const done=new Promise((ok,fail)=>{
    child.once('error',fail);
    child.once('close',code=>code===0?ok():fail(new Error(
      'Docker PostgreSQL command failed (exit '+code+'): '+errors.join('').slice(0,1200)
    )));
  });
  if(stream)return {child,done};
  return (async()=>{
    const output=[];
    child.stdout.on('data',data=>{if(output.reduce((n,v)=>n+v.length,0)<262144)output.push(data);});
    child.stdin.end();
    await done;
    return Buffer.concat(output).toString('utf8').trim();
  })();
}
function archivePath(file){
  invariant(typeof file==='string'&&file.length>0,'Provide --file <path of an existing .tpsbak archive>');
  const full=resolve(root,file);
  const rel=relative(backupDir,full);
  invariant(rel.length>0&&!rel.startsWith('..'+sep)&&rel!=='..'&&!resolve(full).includes('\0'),
    'Archive must be inside private-data/backups');
  invariant(full.endsWith('.tpsbak'),'Archive must end in .tpsbak');
  return full;
}
function fileArg(){
  invariant(process.argv[3]==='--file'&&process.argv.length===5,
    'Usage: backup | verify --file private-data/backups/name.tpsbak | restore-test --file ...');
  return archivePath(process.argv[4]);
}
async function backup(){
  await mkdir(backupDir,{recursive:true,mode:0o700});
  const file=join(backupDir,
    'tps_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+randomBytes(4).toString('hex')+'.tpsbak');
  const partial=file+'.partial';
  const salt=randomBytes(16),iv=randomBytes(12);
  const key=scryptSync(passphrase,salt,32,{maxmem:64*1024*1024});
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const handle=await open(partial,'wx',0o600);
  let writable;
  let child;
  try{
    await handle.write(Buffer.concat([magic,salt,iv]),0,HEADER_SIZE,0);
    // FileHandle.createWriteStream(autoClose:false) can keep close() pending on
    // Node 22 after finish. Close the header descriptor and use a separate
    // automatically closing stream for ciphertext and the final auth tag.
    await handle.close();
    writable=createWriteStream(partial,{flags:'r+',start:HEADER_SIZE,flush:true});
    const task=docker(['pg_dump','--format=custom','--no-owner','--no-acl',
      '--username',user,'--dbname',db],{stream:true});
    child=task.child;
    child.stdin.end();
    await Promise.all([pipeline(child.stdout,cipher,writable,{end:false}),task.done]);
    writable.end(cipher.getAuthTag());
    await finished(writable);
    // fsync after the stream has closed: do not rename an unflushed archive.
    const syncHandle=await open(partial,'r+');
    try{await syncHandle.sync();}finally{await syncHandle.close();}
    await rename(partial,file);
    console.log(JSON.stringify({status:'BACKUP_CREATED',file:relative(root,file),
      encrypted:true,format:'AES-256-GCM',postgresFormat:'custom'}));
  }catch(error){
    child?.kill();
    writable?.destroy();
    await handle.close().catch(()=>{});
    await rm(partial,{force:true});
    throw error;
  }
}
async function decryptTo(file,destination){
  const info=await stat(file);
  invariant(info.size>HEADER_SIZE+TAG_SIZE,'Encrypted backup is too short');
  const handle=await open(file,'r');
  let header,tag;
  try{
    header=Buffer.alloc(HEADER_SIZE);
    tag=Buffer.alloc(TAG_SIZE);
    await handle.read(header,0,HEADER_SIZE,0);
    await handle.read(tag,0,TAG_SIZE,info.size-TAG_SIZE);
  }finally{await handle.close();}
  invariant(header.subarray(0,8).equals(magic),'Incorrect encrypted TPS backup format');
  const key=scryptSync(passphrase,header.subarray(8,24),32,{maxmem:64*1024*1024});
  const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(24,36));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(file,{start:HEADER_SIZE,end:info.size-TAG_SIZE-1}),
    decipher,destination);
}
async function feedRestore(file,args){
  const task=docker(args,{stream:true});
  // pg_restore and pg_dump must never print table data into user-visible logs.
  task.child.stdout.resume();
  try{await Promise.all([decryptTo(file,task.child.stdin),task.done]);}
  catch(e){task.child.kill();throw e;}
}
async function verify(file){
  await feedRestore(file,['pg_restore','--list','--username',user]);
  console.log(JSON.stringify({status:'ARCHIVE_VERIFIED',file:relative(root,file),
    check:'authenticated decryption and PostgreSQL custom archive structure'}));
}
async function restoreTest(file){
  await verify(file);
  // The test database name is ALWAYS generated, never supplied by an operator.
  const isolated='tps_restore_'+randomBytes(6).toString('hex');
  invariant(isolated!==db,'Refusing to restore into the source database');
  await docker(['createdb','--username',user,'--template','template0',isolated]);
  console.log(JSON.stringify({status:'ISOLATED_DATABASE_CREATED',database:isolated}));
  await feedRestore(file,['pg_restore','--username',user,'--dbname',isolated,
    '--no-owner','--no-acl','--exit-on-error','--single-transaction']);
  const migrationCount=await docker(['psql','--username',user,'--dbname',isolated,
    '--no-psqlrc','--tuples-only','--no-align','--command',
    'SELECT count(*)::int FROM schema_migrations']);
  invariant(/^\d+$/.test(migrationCount)&&Number(migrationCount)>=14,
    'Restored database is missing expected migration history');
  const counts=await docker(['psql','--username',user,'--dbname',isolated,
    '--no-psqlrc','--tuples-only','--no-align','--field-separator',',','--command',
    'SELECT (SELECT count(*) FROM courses),(SELECT count(*) FROM instructors),'+
    '(SELECT count(*) FROM scenarios),(SELECT count(*) FROM solver_runs)']);
  invariant(/^\d+,\d+,\d+,\d+$/.test(counts),'Restored TPS tables were not accessible');
  console.log(JSON.stringify({status:'RESTORE_TEST_PASSED',database:isolated,
    migrationCount:Number(migrationCount),counts,
    note:'Temporary test DB deliberately retained for explicit inspection; source DB untouched'}));
}
async function main(){
  invariant(['backup','verify','restore-test'].includes(command),
    'Usage: backup | verify --file <archive> | restore-test --file <archive>');
  checkConfig();
  if(command==='backup'){
    invariant(process.argv.length===3,'backup takes no file argument; writes encrypted file to private-data/backups');
    return backup();
  }
  const file=fileArg();
  await realpath(file); // fail clearly for nonexistent file
  if(command==='verify')return verify(file);
  return restoreTest(file);
}
main().catch(error=>{console.error('TPS backup/restore failed:',error.message);
  process.exitCode=1;});
