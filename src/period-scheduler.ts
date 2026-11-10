import type {Component,Course,Instructor,PlanRequest,Section,Session,TimedMode} from './types.js';
import {periodsFor,minutes,hardSessionConflict,warningCourse} from './lecture-periods.js';
import {roomQualified} from './eligibility.js';
type Job={component:Component;mode:TimedMode;hours:number};
const days=['SUN','MON','TUE','WED','THU'] as const;
const inside=(windows:Array<{day:string;from:number;to:number}>|undefined,s:Session)=>!windows||windows.some(w=>
  w.day===s.day&&minutes(w.from)<=minutes(s.start)&&minutes(w.to)>=minutes(s.end));
/** Fixed clock periods with explicit curriculum credits; all section components remain atomic. */
export function makePeriodSessions(course:Course,section:Section,instructor:Instructor,input:PlanRequest,jobs:Job[],existing:Session[],seed=0):Session[]|null{
  const rules=input.policy.lecturePeriods!,periods=periodsFor(course.code,input.policy)!;
  const result:Session[]=[];
  const rotatedDays=[...days.slice(seed%5),...days.slice(0,seed%5)];
  const rotatedPeriods=[...periods.slice(Math.floor(seed/5)%periods.length),...periods.slice(0,Math.floor(seed/5)%periods.length)];
  const roomOffset=Array.from(instructor.id).reduce((n,c)=>n+c.charCodeAt(0),seed);
  for(const job of jobs){
    if(job.mode!=='ONSITE')return null;
    let remaining=job.hours;
    while(remaining>0){
      const chunk=Math.min(remaining,Math.max(...periods.map(period=>period.trainingHours)));
      let chosen:Session|undefined;
      for(const day of rotatedDays){
        if(chosen)break;
        for(const period of rotatedPeriods){
          if(chunk>period.trainingHours)continue;
          const endMinute=rules.partialPeriod==='FULL_PERIOD'?period.endMinute:period.startMinute+chunk*rules.academicHourMinutes;
          const proposed:Session={id:`${section.id}-F${seed}-${result.length+1}`,sectionId:section.id,courseCode:course.code,
            component:job.component,mode:job.mode,day,start:period.startMinute/60,end:endMinute/60,roomId:null,
            instructorId:instructor.id,blockId:section.blockId,...(section.blockIds?{blockIds:section.blockIds}:{}),
            trainingHours:chunk,cohortOverlapWarning:warningCourse(course.code,input.policy)};
          if(!inside(input.policy.slots,proposed)||!inside(instructor.available,proposed))continue;
          if(course.mode==='HYBRID'&&endMinute>12*60)continue;
          const rooms=input.rooms.filter(room=>roomQualified(room,course,job.component,section.students,input.policy.ignoreRoomCapacity===true)&&inside(room.available,proposed));
          const rotatedRooms=[...rooms.slice(roomOffset%(rooms.length||1)),...rooms.slice(0,roomOffset%(rooms.length||1))];
          for(const room of rotatedRooms){
            proposed.roomId=room.id;
            if([...existing,...result].some(other=>hardSessionConflict(proposed,other,input.policy)))continue;
            chosen={...proposed};break;
          }
          if(chosen)break;
        }
      }
      if(!chosen)return null;
      result.push(chosen);remaining-=chunk;
    }
  }
  return result;
}
