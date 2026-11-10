// CI ONLY: temporary synthetic admin in a disposable PostgreSQL service.
// Refuses to operate without explicit opt-in and on a nonempty user table.
import pg from 'pg';
import argon2 from 'argon2';

if(process.env.TPS_E2E_SYNTHETIC!=='1' || process.env.TPS_DB_INTEGRATION!=='1')
  throw new Error('Only an explicitly isolated synthetic CI database is allowed');
const {DATABASE_URL,TPS_TEST_USERNAME,TPS_TEST_PASSWORD}=process.env;
if(!DATABASE_URL || !TPS_TEST_USERNAME || !TPS_TEST_PASSWORD || TPS_TEST_PASSWORD.length<24)
  throw new Error('Missing ephemeral E2E database or credentials');
const client=new pg.Client({connectionString:DATABASE_URL});
try{
  await client.connect();
  const count=await client.query('SELECT count(*)::int AS n FROM users');
  if(count.rows[0]?.n!==0)throw new Error('E2E admin creation requires an empty user table');
  const hashed=await argon2.hash(TPS_TEST_PASSWORD,{type:argon2.argon2id});
  await client.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,\'SYSTEM_ADMIN\')',
    [TPS_TEST_USERNAME,hashed]);
  console.log('Ephemeral synthetic admin created for local CI browser test');
}finally{await client.end();}
