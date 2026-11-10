import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
process.loadEnvFile('.env');const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');url.pathname='/tps_operational_local';process.env.DATABASE_URL=url.href;
const {pool}=await import('../dist/src/api/database.js');const {splitTeachingSections}=await import('../dist/src/load-targets.js');
const {buildDraftPlan}=await import('../dist/src/planner.js');const {optimizeWithTimefold}=await import('../dist/src/optimizer.js');const {assessReadiness}=await import('../dist/src/api/readiness.js');
const department='f8c1f6d5-ede4-463f-bef4-0021e97f62cf';const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rulesFor=instructor=>['5','6'].includes(instructor.id)?{...instructor.teachingRules,preferredCreditedLoad:24,allowedCourseTypes:['THEORY','MIXED'],preferredCourseTypes:['MIXED','THEORY']}:['3','4'].includes(instructor.id)?{...instructor.teachingRules,allowedCourseTypes:['PRACTICAL','THEORY']}:instructor.teachingRules;
try{
 const before=(await pool.query('SELECT * FROM scenarios WHERE department_id=$1 ORDER BY created_at',[department])).rows;
 const instructors=(await pool.query('SELECT * FROM instructors WHERE department_id=$1 ORDER BY code',[department])).rows;
 assert.ok(before.every(row=>row.state==='DRAFT'&&row.solver_status!=='RUNNING'));
 const prepared=[];
 for(const row of before){let input=structuredClone(row.input_snapshot);
  for(const instructor of input.instructors){instructor.teachingRules=rulesFor(instructor);if(['5','6'].includes(instructor.id))instructor.maxLoad=24;}
  if(input.projection?.key==='CAP_120_40_ECO50')input=splitTeachingSections(input,['ادار-285','رياد-262','ادار-241']);
  let result=buildDraftPlan(input),settings=null,score=null,elapsed=0;
  if(input.projection){
   const start=Date.now();for(const seconds of [15,30]){
    settings={seconds,candidatesPerInstructor:24};result=await optimizeWithTimefold(input,settings);
    if(['5','6'].every(id=>result.instructorLoads.find(load=>load.id===id).credited===24)&&input.policy.priorityCourseCodes.every(code=>result.sections.filter(section=>section.courseCode===code).every(section=>section.state==='SCHEDULED')))break;
   }
   elapsed=Date.now()-start;
   for(const id of ['5','6'])assert.equal(result.instructorLoads.find(load=>load.id===id).credited,24,'Target missed '+input.projection.key+' '+id);
   for(const section of result.sections.filter(section=>section.instructorId)){
    const course=input.courses.find(course=>course.code===section.courseCode);
    if(['5','6'].includes(section.instructorId))assert.ok(course.theoryHours>0);
    if(course.theoryHours&&course.practicalHours)assert.ok(['5','6'].includes(section.instructorId));
   }
   for(const code of input.policy.priorityCourseCodes)assert.ok(result.sections.filter(section=>section.courseCode===code).every(section=>section.state==='SCHEDULED'));
   assert.equal(result.sections.filter(section=>section.instructorId==='1').length,2);
   assert.equal(result.instructorLoads.find(load=>load.id==='2').credited,12);
   const issues=assessReadiness(input,result,'COMPLETED').issues;assert.ok(!issues.some(issue=>issue.severity==='BLOCKER'&&!['UNCOVERED_SECTION','NO_FEASIBLE_TIMETABLE'].includes(issue.code)),JSON.stringify(issues));
   const match=/hard=([-]?\d+), soft=([-]?\d+)/.exec(result.notices.find(n=>n.startsWith('Solver score: '))??'');score={hard:Number(match[1]),soft:Number(match[2])};assert.equal(score.hard,0);
   result.notices.push(...input.projection.assumptions);
  }
  const summary={key:input.projection?.key??row.id,sections:result.sections.length,scheduled:result.sections.filter(s=>s.state==='SCHEDULED').length,gaps:result.gaps.length,loads:result.instructorLoads.map(load=>({id:load.id,credited:load.credited}))};
  prepared.push({id:row.id,priorInputHash:hash(row.input_snapshot),priorResultHash:hash(row.result_snapshot),input,result,settings,score,elapsed,summary});console.log(JSON.stringify(summary));
 }
 writeFileSync('test-reports/load24-prepared.json',JSON.stringify({at:new Date().toISOString(),before,instructors,prepared},null,2));
}finally{await pool.end();}
