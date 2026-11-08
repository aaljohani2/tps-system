import type {Course,Policy,Session,LecturePeriod} from './types.js';
import {hasSharedBlock} from './cohort-grouping.js';
export function withRequestedLecturePeriods(source:Policy,partialPeriod:'TRIM_END'|'FULL_PERIOD'):Policy{
  const policy=structuredClone(source);
  policy.lecturePeriods={academicHourMinutes:50,partialPeriod,
    regular:[{startMinute:480,endMinute:580,trainingHours:2},{startMinute:600,endMinute:700,trainingHours:2},{startMinute:720,endMinute:820,trainingHours:2}],
    courseOverrides:{'اقصد-101':{allowCohortOverlap:true,periods:[{startMinute:420,endMinute:570,trainingHours:3},
      {startMinute:600,endMinute:750,trainingHours:3},{startMinute:720,endMinute:870,trainingHours:3}]}}};
  policy.slots=(['SUN','MON','TUE','WED','THU'] as const).map(day=>({day,from:7,to:14.5}));
  return policy;
}

export const minutes=(hour:number)=>Math.round(hour*60);
export const formatClock=(hour:number)=>{
  const value=minutes(hour);return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
};
export function periodsFor(courseCode:string,policy:Policy):LecturePeriod[]|undefined{
  return policy.lecturePeriods?.courseOverrides[courseCode]?.periods??policy.lecturePeriods?.regular;
}
export function trainingHours(session:Session,policy:Policy):number{
  return policy.lecturePeriods&&session.mode==='ONSITE'?session.trainingHours??NaN:session.end-session.start;
}
export function warningCourse(courseCode:string,policy:Policy):boolean{
  return policy.lecturePeriods?.courseOverrides[courseCode]?.allowCohortOverlap===true;
}
export function cohortOverlapIsWarning(a:Session,b:Session,policy:Policy):boolean{
  return a.sectionId!==b.sectionId&&a.courseCode!==b.courseCode&&(warningCourse(a.courseCode,policy)||warningCourse(b.courseCode,policy));
}
export function hardSessionConflict(a:Session,b:Session,policy:Policy):boolean{
  if(a.day!==b.day||minutes(a.start)>=minutes(b.end)||minutes(b.start)>=minutes(a.end))return false;
  return a.sectionId===b.sectionId||a.instructorId===b.instructorId||
    (a.roomId!==null&&a.roomId===b.roomId)|| (hasSharedBlock(a,b)&&!cohortOverlapIsWarning(a,b,policy));
}
export function validPeriodSession(session:Session,policy:Policy):boolean{
  const rules=policy.lecturePeriods;if(!rules||session.mode!=='ONSITE')return false;
  const hours=session.trainingHours;
  if(!Number.isInteger(hours)||hours!<=0)return false;
  const period=periodsFor(session.courseCode,policy)?.find(p=>p.startMinute===minutes(session.start));
  if(!period||hours!>period.trainingHours)return false;
  const end=rules.partialPeriod==='FULL_PERIOD'?period.endMinute:period.startMinute+hours!*rules.academicHourMinutes;
  return minutes(session.end)===end&&Math.abs(session.start*60-minutes(session.start))<1e-6&&
    Math.abs(session.end*60-minutes(session.end))<1e-6&&
    session.cohortOverlapWarning===warningCourse(session.courseCode,policy);
}
export function courseClockHours(course:Course,policy:Policy):number{
  if(course.mode==='SELF_PACED')return 0;
  if(!policy.lecturePeriods||course.mode!=='ONSITE')return course.theoryHours+course.practicalHours;
  const periods=periodsFor(course.code,policy)!;
  const capacity=Math.max(...periods.map(period=>period.trainingHours));
  return [course.theoryHours,course.practicalHours].reduce((sum,hours)=>{
    let remaining=hours,occupied=0;
    while(remaining>0){const chunk=Math.min(remaining,capacity),period=periods.find(period=>period.trainingHours>=chunk)!;
      occupied+=policy.lecturePeriods!.partialPeriod==='FULL_PERIOD'?period.endMinute-period.startMinute:chunk*policy.lecturePeriods!.academicHourMinutes;
      remaining-=chunk;
    }return sum+occupied/60;
  },0);
}
