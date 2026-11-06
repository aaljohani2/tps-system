import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import fastifyStatic from '@fastify/static';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pool} from './database.js';
import {registerSecurity} from './security.js';
import {registerCatalog} from './catalog.js';
import {registerScenarios} from './scenarios.js';
import {registerPolicies} from './policies.js';
import {registerAcademic} from './academic.js';
import {registerDashboard} from './dashboard.js';
import {registerUsers} from './users.js';
import {registerManualScheduling} from './manual-routes.js';
import {ZodError} from 'zod';

export async function createApp(){
  const app=Fastify({logger:{redact:['req.headers.cookie','req.headers.authorization','req.body.password']},
    bodyLimit:Number(process.env.MAX_REQUEST_BYTES??'5242880')});
  app.setErrorHandler((error,req,reply)=>{
    const status=(error as {statusCode?:number}).statusCode;
    const code=error instanceof ZodError?400:status&&status>=400&&status<500?status:500;
    if(code===500)req.log.error(error);
    reply.code(code).send({error:code===500?'Internal server error':error.message,
      ...(code===400&&'details' in error?{details:(error as Error&{details?:unknown}).details}:{})});
  });
  await app.register(swagger,{openapi:{info:{title:'TPS Local API',version:'1.0.0-dev'},
    servers:[{url:'http://127.0.0.1:8787'}]}});
  app.addContentTypeParser('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
  await registerSecurity(app);
  await registerCatalog(app);
  await registerAcademic(app);
  await registerDashboard(app);
  await registerUsers(app);
  await registerPolicies(app);
  await registerScenarios(app);
  await registerManualScheduling(app);
  app.get('/health',async()=>{
    await pool.query('SELECT 1');
    return {status:'ok',database:'ok',storage:'PostgreSQL',mode:'local-only'};
  });
  const web=resolve('frontend/dist');
  if(existsSync(web)){
    await app.register(fastifyStatic,{root:web,prefix:'/'});
    app.setNotFoundHandler(async(req,reply)=>{
      if(req.method==='GET'&&!req.url.startsWith('/api/'))return reply.sendFile('index.html');
      return reply.code(404).send({error:'Not found'});
    });
  }else app.get('/',async()=>({message:'Frontend not built. Run npm run web:install and npm run web:build.'}));
  return app;
}
