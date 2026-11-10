import type {Component,Course,Instructor,Room} from './types.js';
import {courseType} from './instructor-rules.js';

/** A missing specialty/equipment list never implies qualification when a requirement exists.
 * Code lists use explicit exact identifiers; no fuzzy matching or unapproved substitutions.
 */
export function trainerQualified(instructor:Instructor,course:Course):boolean{
  if(instructor.teachingRules?.allowedCourseTypes&&!instructor.teachingRules.allowedCourseTypes.includes(courseType(course)))return false;
  if(!instructor.allowedModes.includes(course.mode))return false;
  if(course.mode==='HYBRID'&&(!instructor.allowedModes.includes('ONSITE')||!instructor.allowedModes.includes('REMOTE')))return false;
  if(instructor.eligibleCourseCodes&&!instructor.eligibleCourseCodes.includes(course.code))return false;
  if(instructor.exclusiveCourseCodes&&!instructor.exclusiveCourseCodes.includes(course.code))return false;
  if(course.assignedInstructorId&&instructor.id!==course.assignedInstructorId)return false;
  return (course.requiredSpecialties??[]).every(s=>(instructor.specialties??[]).includes(s));
}
export function roomQualified(room:Room,course:Course,component:Component,students:number,ignoreCapacity=false):boolean{
  if(!ignoreCapacity&&(room.capacity===null||room.capacity<students))return false;
  if(!(room.type==='MULTI'||(component==='THEORY'?room.type==='CLASSROOM':room.type==='LAB')))return false;
  return (course.requiredEquipment??[]).every(e=>(room.equipmentCodes??[]).includes(e));
}
