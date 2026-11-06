import type {PlanRequest,PlanResult,Session} from '../types.js';

export interface ReadinessIssue{
  code:string;severity:'BLOCKER'|'WARNING';message:string;sectionId?:string;courseCode?:string;
}
const overlap=(a:Session,b:Session)=>a.day===b.day && a.start<b.end && b.start<a.end;
export function assessReadiness(input:PlanRequest,result:PlanResult,solverStatus:string){
  const issues:ReadinessIssue[]=[];
  const add=(code:string,message:string,sectionId?:string,courseCode?:string,severity:'BLOCKER'|'WARNING'='BLOCKER')=>{
    issues.push({code,severity,message,...(sectionId?{sectionId}:{}),...(courseCode?{courseCode}:{})});
  };
  if(solverStatus!=='COMPLETED')add('SOLVER_NOT_COMPLETED','Timefold has not completed successfully.');
  if(!result.sections.length)add('NO_SECTIONS','No sections were generated from current demand.');
  const scheduled=new Map<string,Session[]>();
  for(const meeting of result.sessions){
    scheduled.set(meeting.sectionId,[...(scheduled.get(meeting.sectionId)??[]),meeting]);
  }
  const sections=new Set(result.sections.map(s=>s.id));
  for(const meeting of result.sessions)if(!sections.has(meeting.sectionId))
    add('UNKNOWN_SECTION','Meeting references unknown section',meeting.sectionId,meeting.courseCode);
  for(const section of result.sections){
    const sessions=scheduled.get(section.id)??[];
    if(section.state==='UNASSIGNED')add('UNCOVERED_SECTION','Section has no assigned timetable.',section.id,section.courseCode);
    if(section.students>0&&!section.blockId)add('MISSING_BLOCK','No verified student cohort block for section.',section.id,section.courseCode);
    if(section.state==='SCHEDULED'){
      const actual=sessions.reduce((sum,m)=>sum+m.end-m.start,0);
      if(actual!==section.contactHours)add('INCOMPLETE_HOURS',
        `Section requires ${section.contactHours} hours but has ${actual}.`,section.id,section.courseCode);
    }
    if(section.state!=='SCHEDULED'&&sessions.length)
      add('UNEXPECTED_SESSIONS','Non-timed or unassigned section contains scheduled meetings.',section.id,section.courseCode);
  }
  for(const gap of result.gaps)add(gap.reason,
    `Uncovered ${gap.contactHours} weekly contact hours; equivalent load ${gap.equivalentLoad}.`,gap.sectionId,gap.courseCode);
  const roomMap=new Map(input.rooms.map(r=>[r.id,r]));
  const instructorMap=new Map(input.instructors.map(i=>[i.id,i]));
  const sectionMap=new Map(result.sections.map(sec=>[sec.id,sec]));
  const courseMap=new Map(input.courses.map(course=>[course.code,course]));
  const inside=(windows:Array<{day:string;from:number;to:number}>|undefined,meeting:Session)=>{
    return !windows || windows.some(w=>w.day===meeting.day&&w.from<=meeting.start&&w.to>=meeting.end);
  };
  const componentHours=(course:PlanRequest['courses'][number],sessions:Session[])=>{
    const sum=(component:'THEORY'|'PRACTICAL',mode:'ONSITE'|'REMOTE')=>
      sessions.filter(s=>s.component===component&&s.mode===mode).reduce((v,s)=>v+s.end-s.start,0);
    if(course.mode==='HYBRID'){
      const h=course.hybridSplit;
      return !!h && sum('THEORY','ONSITE')===h.theoryOnsiteHours &&
        sum('THEORY','REMOTE')===h.theoryRemoteHours &&
        sum('PRACTICAL','ONSITE')===h.practicalOnsiteHours &&
        sum('PRACTICAL','REMOTE')===h.practicalRemoteHours;
    }
    return sum('THEORY',course.mode==='REMOTE'?'REMOTE':'ONSITE')===course.theoryHours &&
      sum('PRACTICAL',course.mode==='REMOTE'?'REMOTE':'ONSITE')===course.practicalHours;
  };
  for(const section of result.sections){
    const course=courseMap.get(section.courseCode);
    if(section.state==='SCHEDULED'&&course && !componentHours(course,scheduled.get(section.id)??[]))
      add('COMPONENT_HOURS','Theory/practical or hybrid delivery hours are not correctly distributed.',section.id,section.courseCode);
  }
  for(const session of result.sessions){
    const instructor=instructorMap.get(session.instructorId);
    const course=courseMap.get(session.courseCode);
    const section=sectionMap.get(session.sectionId);
    if(!instructor)
      add('UNKNOWN_INSTRUCTOR','Session instructor missing from scenario.',session.sectionId,session.courseCode);
    else{
      if(!instructor.allowedModes.includes(course?.mode??'ONSITE') ||
        (course?.mode==='HYBRID'&&(!instructor.allowedModes.includes('ONSITE')||!instructor.allowedModes.includes('REMOTE'))) ||
        (instructor.eligibleCourseCodes&&!instructor.eligibleCourseCodes.includes(session.courseCode)) ||
        (course?.assignedInstructorId && instructor.id!==course.assignedInstructorId))
        add('INELIGIBLE_INSTRUCTOR','Instructor is not eligible or conflicts with a locked assignment.',session.sectionId,session.courseCode);
      if(!inside(instructor.available,session))
        add('INSTRUCTOR_UNAVAILABLE','Session falls outside instructor availability.',session.sectionId,session.courseCode);
    }
    if(!course||!section||section.courseCode!==session.courseCode||section.blockId!==session.blockId)
      add('SESSION_COHORT_MISMATCH','Course, section and block identity do not match.',session.sectionId,session.courseCode);
    if(!Number.isInteger(session.start*2)||!Number.isInteger(session.end*2)||
      session.start>=session.end || session.end-session.start>input.policy.sessionMaxHours ||
      !inside(input.policy.slots,session) ||
      (session.day==='THU'&&session.end>10))
      add('INVALID_TIME','Session is outside approved policy windows or half-hour granularity.',session.sectionId,session.courseCode);
    if(course && (course.mode==='SELF_PACED' ||
      (course.mode!=='HYBRID' && session.mode!==course.mode) ||
      (course.mode==='HYBRID' && (session.mode==='ONSITE'?session.end>12:session.start<16||session.end>22))))
      add('DELIVERY_MODE_VIOLATION','Session mode/time conflicts with approved delivery pattern.',session.sectionId,session.courseCode);
    if(session.mode==='ONSITE'){
      const room=session.roomId?roomMap.get(session.roomId):null;
      const students=section?.students??0;
      if(!room||room.capacity<students)
        add('ROOM_CAPACITY','Required room is missing or has insufficient capacity.',session.sectionId,session.courseCode);
      else if(!inside(room.available,session) ||
        !(room.type==='MULTI'||(session.component==='THEORY'?room.type==='CLASSROOM':room.type==='LAB')))
        add('ROOM_INCOMPATIBLE','Room equipment/type or availability is unsuitable for component.',session.sectionId,session.courseCode);
    }else if(session.roomId!==null)
      add('REMOTE_ROOM','Remote session must not consume a physical room.',session.sectionId,session.courseCode);
  }
  for(let i=0;i<result.sessions.length;i++){
    const a=result.sessions[i]!;
    for(let j=i+1;j<result.sessions.length;j++){
      const b=result.sessions[j]!;
      if(overlap(a,b) && (a.instructorId===b.instructorId ||
          (a.roomId!==null&&a.roomId===b.roomId) ||
          (a.blockId!==null&&a.blockId===b.blockId)||a.sectionId===b.sectionId))
        add('TIMETABLE_COLLISION',`Conflicting meetings: ${a.id} / ${b.id}`,a.sectionId,a.courseCode);
    }
  }
  for(const instructor of result.instructorLoads)
    if(instructor.remaining < -0.0001)add('LOAD_EXCEEDED',`Trainer ${instructor.id} exceeds credited load.`);
  const m=result.metrics;
  if(Math.abs(m.assignedContactHours+m.uncoveredContactHours-m.requiredContactHours)>0.001)
    add('INCONSISTENT_TOTALS','Contact-hour totals do not reconcile.');
  const byCourse=input.courses.map(course=>{
    const sections=result.sections.filter(s=>s.courseCode===course.code);
    return {code:course.code,title:course.title,demand:course.demand,
      sections:sections.length,uncovered:sections.filter(s=>s.state==='UNASSIGNED').length,
      missingBlocks:sections.filter(s=>s.students>0&&!s.blockId).length};
  });
  return {technicalReady:!issues.some(i=>i.severity==='BLOCKER'),issues,byCourse,
    status:solverStatus,sections:result.sections.length,meetings:result.sessions.length,
    uncoveredHours:m.uncoveredContactHours};
}
