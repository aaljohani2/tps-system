import type {PlanRequest} from './types.js';
import {applyCourseCapacityException} from './course-capacity-exception.js';
import {validateRequest} from './validation.js';

export type ExternalDefinition={code:string;capacity:number;responsibleDepartment?:string|null};
/** Normalize demand before excluding delivery from the department's optimization problem. */
export function applyExternalAssignments(source:PlanRequest,definitions?:ExternalDefinition[]):PlanRequest{
  const selected=definitions??source.courses.filter(course=>course.assignmentScope==='EXTERNAL').map(course=>({
    code:course.code,capacity:course.externalSectionCapacity??40,responsibleDepartment:course.responsibleDepartment}));
  if(!selected.length)return source;
  if(new Set(selected.map(item=>item.code)).size!==selected.length)throw new Error('Duplicate external course definition');
  let input=structuredClone(source);
  for(const item of selected){
    const course=input.courses.find(course=>course.code===item.code);
    if(!course)throw new Error('Unknown external course: '+item.code);
    course.assignmentScope='DEPARTMENT';
  }
  for(const item of selected){
    if(input.courses.every(course=>course.demand===0||(course.blocks?.length&&course.blockSizes?.length)))
      input=applyCourseCapacityException(input,item.code,item.capacity);
    else{
      const pending=input.courses.find(course=>course.code===item.code)!;
      pending.sectionCapacity=item.capacity;delete pending.blocks;delete pending.blockSizes;delete pending.blockGroups;
      input.policy.courseSectionCapacities={...input.policy.courseSectionCapacities,[item.code]:item.capacity};
    }
    const course=input.courses.find(course=>course.code===item.code)!;
    course.assignmentScope='EXTERNAL';course.externalSectionCapacity=item.capacity;
    course.responsibleDepartment=item.responsibleDepartment??null;
  }
  validateRequest(input);return input;
}
