import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pool} from './database.js';

async function main(): Promise<void> {
  const sql = await readFile(resolve('db/migrations/0001_foundation.sql'),'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(4471728)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const present = await client.query<{sha256:string}>('SELECT sha256 FROM schema_migrations WHERE version=$1',['0001_foundation']);
    if (!present.rowCount) {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version,sha256) VALUES ($1,$2)',['0001_foundation',checksum]);
      console.log('Applied migration 0001_foundation');
    } else if(present.rows[0]?.sha256!==checksum) throw new Error('Migration checksum changed: 0001_foundation');
    else console.log('Migration already applied');
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error;}
  finally {client.release();await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
