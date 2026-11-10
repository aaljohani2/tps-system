import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {optimizeWithTimefold} from '../src/optimizer.js';
import type {PlanRequest} from '../src/types.js';

const jar='solver/target/tps-timefold-0.2.0-jar-with-dependencies.jar';
const fixture=():PlanRequest=>JSON.parse(readFileSync('examples/onsite.json','utf8')) as PlanRequest;

// When Java is built in the PostgreSQL integration job this exercises a real
// spawned process. Node-only jobs skip it rather than reporting a false pass.
test('abort during real Timefold execution kills the Java child and never accepts a draft', {
  skip:!existsSync(jar)
},async()=>{
  const controller=new AbortController();
  const invocation=optimizeWithTimefold(fixture(),{jar,seconds:30,timeoutMs:45000,signal:controller.signal});
  const timer=setTimeout(()=>controller.abort(),150);
  try{
    await assert.rejects(invocation,/Solver cancelled by operator/);
  }finally{clearTimeout(timer);}
});
