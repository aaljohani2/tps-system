import type {PlanRequest,PlanResult,Course} from './types.js';
import {validateRequest} from './validation.js';
import {assessReadiness} from './api/readiness.js';

export const LOAD24_KEYS = ['BASE_157','CAP_100_50_40','CAP_120_40_ECO50'] as const;
export const LOAD24_TARGETS = ['5','6'] as const;
const close=(a:number,b:number)=>Math.abs(a-b)<0.001;
const fail=(message:string):never=>{throw new Error('LOAD24_GATE: '+message);};
const countBy=(list:Course[],field:(c:Course)=>number)=>Object.fromEntries(list.map(c=>[c.code,field(c)]));
const levelPopulation=(input:PlanRequest)=>JSON.stringify([1,2,3,4].map(level=>
 (input.cohortBlocks??[]).filter(b=>b.level===level).reduce((n,b)=>n+b.size,0)));

export function prepareLoad24Input(source:PlanRequest,split:(input:PlanRequest,codes:string[])=>PlanRequest):PlanRequest{
 if(!source.projection||!LOAD24_KEYS.includes(source.projection.key as typeof LOAD24_KEYS[number]))
  return fail('Only the three named next-term projections may be prepared');
 const original=structuredClone(source);
 for(const id of LOAD24_TARGETS){
  const trainer=original.instructors.find(i=>i.id===id);
  if(!trainer)return fail('Target trainer code absent: '+id);
  if(trainer.maxLoad+(trainer.overload?.additionalHours??0)<24)
   return fail('Trainer '+id+' has no approved capacity for 24 credited hours');
  trainer.teachingRules={...trainer.teachingRules,
   preferredCreditedLoad:24,allowedCourseTypes:['THEORY','MIXED'],preferredCourseTypes:['MIXED','THEORY']};
 }
 for(const trainer of original.instructors.filter(i=>['3','4'].includes(i.id)))
  trainer.teachingRules={...trainer.teachingRules,allowedCourseTypes:['PRACTICAL','THEORY']};
 let input=original;
 if(source.projection.key==='CAP_120_40_ECO50'){
  for(const code of ['ادار-285','رياد-262','ادار-241'])
   if(!input.courses.some(c=>c.code===code))return fail('Cannot split a missing course: '+code);
  input=split(input,['ادار-285','رياد-262','ادار-241']);
 }
 validateRequest(input);
 for(const previous of source.instructors){
  const changed=input.instructors.find(t=>t.id===previous.id);
  if(!changed || changed.maxLoad!==previous.maxLoad ||
    JSON.stringify(changed.overload??null)!==JSON.stringify(previous.overload??null))
   return fail('Base instructor loads and approved exceptions must remain unchanged');
 }
 return input;
}

export function verifyLoad24Result(source:PlanRequest,before:PlanResult,input:PlanRequest,result:PlanResult):{
 key:string;sections:number;scheduled:number;gaps:number;targetLoads:Record<string,number>;score:{hard:number;soft:number};
} {
 validateRequest(input);
 if(!source.projection||source.projection.key!==input.projection?.key)return fail('Projection source mismatch');
 const key=input.projection.key;
 if(!LOAD24_KEYS.includes(key as typeof LOAD24_KEYS[number]))return fail('Unexpected projection key');
 if(source.termId!==input.termId || source.courses.length!==input.courses.length)
  return fail('Term or course count changed');
 const left=new Map(source.courses.map(c=>[c.code,c])),right=new Map(input.courses.map(c=>[c.code,c]));
 if(left.size!==right.size)return fail('Duplicate or missing course code');
 for(const [code,old] of left){
  const next=right.get(code);
  if(!next)return fail('Missing course: '+code);
  for(const field of ['level','demand','theoryHours','practicalHours','mode','assignmentScope','externalSectionCapacity','responsibleDepartment'] as const)
   if((old[field]??null)!==(next[field]??null))return fail('Unapproved course fact changed: '+code+'/'+field);
 }
 if(JSON.stringify(countBy(source.courses,c=>c.demand))!==JSON.stringify(countBy(input.courses,c=>c.demand)))
  return fail('Course population changed');
 if(levelPopulation(source)!==levelPopulation(input))return fail('Cohort headcounts changed');
 if(JSON.stringify(source.policy.priorityCourseCodes??[])!==JSON.stringify(input.policy.priorityCourseCodes??[]))
  return fail('Priority course selection changed');
 for(const old of source.instructors){
  const trainer=input.instructors.find(i=>i.id===old.id);
  if(!trainer||trainer.maxLoad!==old.maxLoad||
    JSON.stringify(trainer.overload??null)!==JSON.stringify(old.overload??null))
   return fail('Trainer eligibility or official base limits must not be silently raised');
 }
 const targetLoads:Record<string,number>={};
 for(const code of LOAD24_TARGETS){
  const trainer=input.instructors.find(i=>i.id===code),load=result.instructorLoads.find(l=>l.id===code);
  if(!trainer||!load||!close(load.credited,24)||!close(trainer.teachingRules?.preferredCreditedLoad??-1,24))
   return fail('24 credited hours not proven for trainer '+code);
  targetLoads[code]=load.credited;
 }
 for(const sec of result.sections.filter(s=>s.instructorId&&s.state!=='UNASSIGNED')){
  const course=right.get(sec.courseCode);
  if(!course)return fail('Assigned section lacks an input course');
  if(LOAD24_TARGETS.some(code=>code===sec.instructorId) && (course.theoryHours===0||course.practicalHours>0&&course.theoryHours===0))
   return fail('Practical-only section assigned to trainer '+sec.instructorId);
  if(course.theoryHours>0&&course.practicalHours>0 && !LOAD24_TARGETS.some(code=>code===sec.instructorId))
   return fail('Mixed course assigned outside designated trainers');
 }
 for(const code of input.policy.priorityCourseCodes??[]){
  if(input.courses.some(c=>c.code===code&&c.assignmentScope!=='EXTERNAL'&&c.demand>0) &&
    (!result.sections.some(s=>s.courseCode===code)||result.sections.some(s=>s.courseCode===code&&s.state!=='SCHEDULED')))
   return fail('Priority department course is not fully covered: '+code);
 }
 const scoreLine=result.notices.find(line=>line.startsWith('Solver score: '))??'';
 const m=/^Solver score: hard=(-?\d+), soft=(-?\d+)$/.exec(scoreLine);
 if(!m || Number(m[1])!==0)return fail('Cannot prove a zero-hard-score Timefold solve');
 const readiness=assessReadiness(input,result,'COMPLETED');
 const unexpected=readiness.issues.filter(issue=>issue.severity==='BLOCKER'&&
   !['UNCOVERED_SECTION','NO_FEASIBLE_TIMETABLE'].includes(issue.code));
 if(unexpected.length)return fail('Unexpected readiness blockers: '+unexpected.map(i=>i.code).join(', '));
 if(result.externalSections?.length!==before.externalSections?.length)
  return fail('External teaching sections count changed');
 if(result.externalSections?.reduce((n,x)=>n+x.students,0)!==before.externalSections?.reduce((n,x)=>n+x.students,0))
  return fail('External student demand changed');
 return {key,sections:result.sections.length,scheduled:result.sections.filter(s=>s.state==='SCHEDULED').length,
  gaps:result.gaps.length,targetLoads,score:{hard:0,soft:Number(m[2])}};
}
