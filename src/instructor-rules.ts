import type {Course,CourseType,Instructor,Section} from './types.js';

export function courseType(course:Pick<Course,'theoryHours'|'practicalHours'>):CourseType{
  return course.theoryHours>0&&course.practicalHours>0?'MIXED':course.theoryHours>0?'THEORY':'PRACTICAL';
}
export function typePreference(instructor:Instructor,course:Course):number{
  return instructor.teachingRules?.preferredCourseTypes?.includes(courseType(course))?20:0;
}
export function instructorTotals(instructorId:string,sections:Section[]){
  const owned=sections.filter(section=>section.instructorId===instructorId&&section.state!=='UNASSIGNED');
  return {sections:owned.length,contact:owned.filter(section=>section.state==='SCHEDULED').reduce((sum,section)=>sum+section.contactHours,0)};
}
export function exceedsTeachingLimits(instructor:Instructor,sections:number,contact:number):boolean{
  const rules=instructor.teachingRules;
  return (rules?.maxSections!==undefined&&sections>rules.maxSections)||
    (rules?.maxContactHours!==undefined&&contact>rules.maxContactHours+1e-8);
}
