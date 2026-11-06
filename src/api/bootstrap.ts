import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import argon2 from 'argon2';
import {pool} from './database.js';

async function main(){
  const cli=createInterface({input:stdin,output:stdout});
  try {
    const count=await pool.query<{count:string}>('SELECT count(*)::text AS count FROM users');
    if(Number(count.rows[0]?.count)!==0) throw new Error('Bootstrap can only run on an empty users table.');
    const username=(await cli.question('Administrator username: ')).trim();
    const password=process.env.TPS_BOOTSTRAP_PASSWORD;
    if(!username || !password || password.length<16) throw new Error('Set TPS_BOOTSTRAP_PASSWORD locally to a strong password (16+ chars); it will not be committed.');
    const hash=await argon2.hash(password,{type:argon2.argon2id});
    await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3)',[username,hash,'SYSTEM_ADMIN']);
    console.log('Administrator created; unset TPS_BOOTSTRAP_PASSWORD from shell.');
  } finally {cli.close();await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
