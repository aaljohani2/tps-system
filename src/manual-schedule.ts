import type {Day,PlanRequest,PlanResult,Room,Session} from './types.js';
import {assessReadiness} from './api/readiness.js';
import {trainerQualified,roomQualified} from './eligibility.js';
import {minutes} from './lecture-periods.js';

const bad=(message:string)=>Object.assign(new Error(message),{statusCode:409});
export type ManualMove={sessionId:string;day:Day;start:number;roomId:string|null;instructorId:string};
function number3(n:number){return Math.round(n*1000)/1000;}

/** Modify a complete Timefold result in memory, never touching an approved snapshot.
 * Full-section instructor reassignment preserves the theory/practical 1:1 pairing.
 * No implicit room, trainer, cohort or course selection is ever fabricated.
 */
export function moveScheduledSession(input:PlanRequest,original:PlanResult,move:ManualMove):PlanResult{
  const before=assessReadiness(input,original,'COMPLETED');
  // An operator must be able to FIX an existing collision. Disallow new or
  // intensified blockers; permit a strictly improving edit while other
  // unrelated pending blockers remain. Approved snapshots are protected upstream.
  const result:PlanResult=structuredClone(original);
  const target=result.sessions.find(s=>s.id===move.sessionId);
  if(!target)throw bad('Session not found');
  const section=result.sections.find(s=>s.id===target.sectionId);
  if(!section||section.state!=='SCHEDULED')throw bad('Only a scheduled section may be moved');
  const course=input.courses.find(c=>c.code===section.courseCode);
  const trainer=input.instructors.find(i=>i.id===move.instructorId);
  if(!course||!trainer)throw bad('Course or trainer does not exist in the immutable scenario snapshot');
  if(!trainerQualified(trainer,course))
    throw bad('Selected instructor violates locked course, specialty or delivery qualification');
  const oldTeacher=section.instructorId;
  if(!oldTeacher)throw bad('Section has no current instructor');
  const fixed=!!input.policy.lecturePeriods&&target.mode==='ONSITE';
  const duration=target.end-target.start,end=fixed?(minutes(move.start)+minutes(duration))/60:number3(move.start+duration);
  if(!Number.isFinite(move.start)||(!fixed&&(!Number.isInteger(move.start*2)||!Number.isInteger(end*2)))||
    move.start<0||end>24)throw bad('Start and end must be valid 30-minute time points');
  if(target.mode==='REMOTE'&&move.roomId!==null)throw bad('Remote session cannot use a physical room');
  if(target.mode==='ONSITE'){
    const room=input.rooms.find(r=>r.id===move.roomId);
    if(!room||!roomQualified(room,course,target.component,section.students,input.policy.ignoreRoomCapacity===true))throw bad('Room capacity or component compatibility is invalid');
  }
  if(course.exclusiveInstructor && result.sections.some(s=>s.courseCode===course.code &&
    s.id!==section.id && s.state!=='UNASSIGNED' && s.instructorId!==trainer.id))
    throw bad('Course requires one instructor for all of its assigned sections');
  for(const meeting of result.sessions.filter(s=>s.sectionId===section.id))
    meeting.instructorId=trainer.id;
  section.instructorId=trainer.id;
  target.day=move.day;
  target.start=move.start;
  target.end=end;
  target.roomId=move.roomId;
  // Rebuild weighted loads from sections, not sessions: paired component meetings
  // must NOT multiply the trainer's credited weekly load.
  result.instructorLoads=input.instructors.map(i=>{
    const owned=result.sections.filter(s=>s.state!=='UNASSIGNED'&&s.instructorId===i.id);
    const credited=number3(owned.reduce((n,s)=>n+s.creditedLoad,0));
    const contact=number3(owned.filter(s=>s.state==='SCHEDULED').reduce((n,s)=>n+s.contactHours,0));
    const exception=i.overload?.additionalHours??0;
    return {id:i.id,baseLimit:i.maxLoad,approvedException:exception,credited,contact,
      ...(input.policy.lecturePeriods?{clockHours:result.sessions.filter(session=>session.instructorId===i.id).reduce((sum,s)=>sum+s.end-s.start,0)}:{}),
      remaining:number3(i.maxLoad+exception-credited)};
  });
  const readiness=assessReadiness(input,result,'COMPLETED');
  if(!readiness.technicalReady){
    const signature=(x:{code:string;sectionId?:string;courseCode?:string;instructorId?:string})=>
      x.code+'|'+(x.sectionId??'')+'|'+(x.courseCode??'')+'|'+(x.instructorId??'');
    const previous=before.issues.filter(x=>x.severity==='BLOCKER');
    const next=readiness.issues.filter(x=>x.severity==='BLOCKER');
    const counts=new Map<string,number>();
    for(const issue of previous){
      const key=signature(issue);
      counts.set(key,(counts.get(key)??0)+1);
    }
    for(const issue of next){
      const key=signature(issue),remaining=counts.get(key)??0;
      if(remaining===0)
        throw bad('Move introduces a new scheduling blocker: '+issue.code+' for '+(issue.sectionId??'scenario'));
      counts.set(key,remaining-1);
    }
    if(next.length>=previous.length)
      throw bad('A conflicted timetable move must strictly reduce existing blockers');
  }
  if(!result.notices.some(n=>n.includes('Manual edits after Timefold')))
    result.notices.push('Manual edits after Timefold: all hard constraints rechecked; not a new Timefold optimization.');
  return result;
}
