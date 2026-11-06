import {pool} from './database.js';
async function main(){
  const db=await pool.query<{ok:number}>('SELECT 1 AS ok');
  const migrations=await pool.query<{version:string}>('SELECT version FROM schema_migrations ORDER BY version');
  if(db.rows[0]?.ok!==1 || !['0001_foundation','0002_policy_and_solver_state'].every(version=>migrations.rows.some(x=>x.version===version))) throw new Error('Database or migration unavailable');
  console.log('PostgreSQL reachable; migrations 0001 and 0002 present');
  await pool.end();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
