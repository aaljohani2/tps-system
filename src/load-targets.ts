import type {PlanRequest,Course,Section} from './types.js';
import {trainerQualified} from './eligibility.js';
import {applyCourseCapacityException} from './course-capacity-exception.js';
import {sectionCapacity} from './section-capacity.js';
import {validateRequest} from './validation.js';
import {periodsFor,minutes} from './lecture-periods.js';
/** Exact section-load packing seeds the preview; scheduling and Timefold still check every meeting. */
export function reserveLoadTargets(input:PlanRequest,jobs:Array<{s:Section;course:Course}>):Map<string,string>{
 const reserved=new Map<string,string>(),priority=new Set(input.policy.priorityCourseCodes??[]);
 for(const instructor of input.instructors.filter(i=>(i.teachingRules?.preferredCreditedLoad??0)>0)){
  const target=Math.round(instructor.teachingRules!.preferredCreditedLoad!*1000);
  const candidates=jobs.filter(job=>!reserved.has(job.s.id)&&job.s.creditedLoad>0&&trainerQualified(instructor,job.course));
  // With three fixed period starts per day, eight 3-hour sections need sixteen
  // meetings and cannot fit a fifteen-start week, even though their load is 24.
  const fixed=input.policy.lecturePeriods;
  const starts=new Set<string>();
  if(fixed)for(const {course} of candidates)for(const period of periodsFor(course.code,input.policy)??[])
   for(const window of input.policy.slots){const from=period.startMinute,to=from+fixed.academicHourMinutes;
    if(from<minutes(window.from)||to>minutes(window.to))continue;
    if(instructor.available&&!instructor.available.some(w=>w.day===window.day&&minutes(w.from)<=from&&minutes(w.to)>=to))continue;
    starts.add(`${window.day}/${from}`);
   }
  const budget=fixed?starts.size:Infinity;
  type Bundle={used:number;meetings:number;score:number;ids:string[]};
  const states=new Map<string,Bundle>([['0/0',{used:0,meetings:0,score:0,ids:[]}]]);
  for(const {s,course} of candidates){const weight=Math.round(s.creditedLoad*1000),score=(priority.has(course.code)?1000000:0)+(course.theoryHours&&course.practicalHours?1000:0)+1;
   const chunk=fixed?Math.max(...periodsFor(course.code,input.policy)!.map(period=>period.trainingHours)):0;
   const count=fixed?Math.ceil(course.theoryHours/chunk)+Math.ceil(course.practicalHours/chunk):0;
   for(const value of [...states.values()]){const next=value.used+weight,meetings=value.meetings+count;if(next>target||meetings>budget)continue;
    const key=`${next}/${meetings}`;
    if(!states.has(key)||states.get(key)!.score<value.score+score)states.set(key,{used:next,meetings,score:value.score+score,ids:[...value.ids,s.id]});
   }
  }
  const best=[...states.values()].sort((a,b)=>b.used-a.used||b.score-a.score||a.meetings-b.meetings)[0]!;
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
