import {pool} from './database.js';
async function main(){
  const db=await pool.query<{ok:number}>('SELECT 1 AS ok');
  const migrations=await pool.query<{version:string}>('SELECT version FROM schema_migrations ORDER BY version');
  if(db.rows[0]?.ok!==1 || !migrations.rows.some(x=>x.version==='0001_foundation')) throw new Error('Database or migration unavailable');
  console.log('PostgreSQL reachable; migration 0001_foundation present');
  await pool.end();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
