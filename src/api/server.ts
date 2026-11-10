import {createApp} from './create-app.js';
import {pool} from './database.js';
const host=process.env.HOST??'127.0.0.1';
if(process.env.TPS_RUNTIME_PROFILE==='LOCAL_PRODUCTION'){
  if(!process.env.DATABASE_URL ||
     decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1))!=='tps_operational_local' ||
     process.env.TPS_ALLOW_SYNTHETIC_SEED==='1' ||
     process.env.TPS_DB_INTEGRATION==='1')
    throw new Error('Local production profile cannot use test DB, synthetic seed or integration test flags');
}
if(host!=='127.0.0.1'&&host!=='localhost')throw new Error('TPS local API must bind to loopback only');
const app=await createApp();
await app.listen({host,port:Number(process.env.PORT??8787)});
const close=async()=>{await app.close();await pool.end();};
process.on('SIGINT',()=>{void close().then(()=>process.exit(0));});
process.on('SIGTERM',()=>{void close().then(()=>process.exit(0));});
