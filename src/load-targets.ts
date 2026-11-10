import type {PlanRequest,Course,Section} from './types.js';
import {trainerQualified} from './eligibility.js';
import {applyCourseCapacityException} from './course-capacity-exception.js';
import {sectionCapacity} from './section-capacity.js';
import {validateRequest} from './validation.js';
/** Exact section-load packing seeds the preview; scheduling and Timefold still check every meeting. */
export function reserveLoadTargets(input:PlanRequest,jobs:Array<{s:Section;course:Course}>):Map<string,string>{
 const reserved=new Map<string,string>(),priority=new Set(input.policy.priorityCourseCodes??[]);
 for(const instructor of input.instructors.filter(i=>(i.teachingRules?.preferredCreditedLoad??0)>0)){
  const target=Math.round(instructor.teachingRules!.preferredCreditedLoad!*1000);
  const candidates=jobs.filter(job=>!reserved.has(job.s.id)&&job.s.creditedLoad>0&&trainerQualified(instructor,job.course));
  const states=new Map<number,{score:number;ids:string[]}>([[0,{score:0,ids:[]}]]);
  for(const {s,course} of candidates){const weight=Math.round(s.creditedLoad*1000),score=(priority.has(course.code)?1000000:0)+(course.theoryHours&&course.practicalHours?1000:0)+1;
   for(const [used,value] of [...states]){const next=used+weight;if(next>target)continue;
    if(!states.has(next)||states.get(next)!.score<value.score+score)states.set(next,{score:value.score+score,ids:[...value.ids,s.id]});
   }
  }
  const best=states.get(target)??states.get(Math.max(...states.keys()))!;
  for(const id of best.ids)reserved.set(id,instructor.id);
 }
 return reserved;
}
/** Explicitly authorized section splits; neither student demand nor maximum capacity increases. */
export function splitTeachingSections(source:PlanRequest,codes:string[]):PlanRequest{
 let input=structuredClone(source);
 for(const code of codes){
  const course=input.courses.find(course=>course.code===code);
  if(!course||course.assignmentScope==='EXTERNAL'||course.demand<2||course.blockSizes?.length!==1)
   throw new Error('Load balancing split requires one verified internal section: '+code);
  const capacity=sectionCapacity(course,input.policy)!;
  const exception=input.policy.courseSectionCapacities?.[code];
  input=applyCourseCapacityException(input,code,Math.ceil(course.demand/2));
  input.courses.find(course=>course.code===code)!.sectionCapacity=capacity;
  if(exception===undefined)delete input.policy.courseSectionCapacities![code];
  else input.policy.courseSectionCapacities![code]=exception;
  input.projection?.assumptions.push(`أعيد تقسيم ${course.title} إلى شعبتين لتحقيق النصاب المطلوب، دون زيادة المتدربين أو السعة القصوى.`);
 }
 if(input.projection)for(const level of [1,2,3,4])input.projection.baseBlocksByLevel[level]=input.cohortBlocks!.filter(block=>block.level===level).length;
 validateRequest(input);return input;
}
