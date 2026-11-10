import type {Course,Policy} from './types.js';

/** Explicit policy exceptions take precedence; other scenario limits stay within the general envelope. */
export function sectionCapacity(course:Course,policy:Policy):number|null{
  if(course.assignmentScope==='EXTERNAL')return course.externalSectionCapacity??40;
  if(course.mode==='SELF_PACED')return null;
  const exception=policy.courseSectionCapacities?.[course.code];
  if(exception!==undefined)return exception;
  const cap=policy.capacities[course.mode];
  const limit=course.theoryHours>0&&course.practicalHours>0?Math.min(cap.theory!,cap.practical!):
    course.theoryHours>0?cap.theory!:cap.practical!;
  return course.sectionCapacity===undefined?limit:Math.min(limit,course.sectionCapacity);
}
