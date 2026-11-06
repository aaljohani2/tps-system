import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pool} from './database.js';

async function main(): Promise<void> {
  const directory=resolve('db/migrations');
  const names=(await readdir(directory)).filter(name=>/^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if(!names.length)throw new Error('No SQL migrations found');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(4471728)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of names){
      const version=name.slice(0,-4),sql=await readFile(resolve(directory,name),'utf8');
      const checksum=createHash('sha256').update(sql).digest('hex');
      const existing=await client.query<{sha256:string}>('SELECT sha256 FROM schema_migrations WHERE version=$1',[version]);
      if(!existing.rowCount){
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version,sha256) VALUES ($1,$2)',[version,checksum]);
        console.log('Applied migration '+version);
      }else if(existing.rows[0]?.sha256!==checksum)throw new Error('Migration checksum changed: '+version);
      else console.log('Migration already applied: '+version);
    }
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error;}
  finally {client.release();await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
