import type {PlanRequest,PlanResult,Session} from '../types.js';
import {trainerQualified,roomQualified} from '../eligibility.js';
import {hasSharedBlock} from '../cohort-grouping.js';
import {sectionCapacity} from '../section-capacity.js';
import {instructorTotals,exceedsTeachingLimits} from '../instructor-rules.js';
import {trainingHours,validPeriodSession,cohortOverlapIsWarning,hardSessionConflict,formatClock} from '../lecture-periods.js';
import {generalLockConflict,validateGeneralSchedule} from '../general-courses.js';
import {stableBlockDiagnostics,stableGeneralLocks,validateStableBlocks} from '../stable-blocks.js';

export interface ReadinessIssue{
  code:string;severity:'BLOCKER'|'WARNING';message:string;sectionId?:string;courseCode?:string;instructorId?:string;
}
const overlap=(a:Session,b:Session)=>a.day===b.day && a.start<b.end && b.start<a.end;
export function assessReadiness(input:PlanRequest,result:PlanResult,solverStatus:string){
  const issues:ReadinessIssue[]=[];
  const add=(code:string,message:string,sectionId?:string,courseCode?:string,severity:'BLOCKER'|'WARNING'='BLOCKER')=>{
    issues.push({code,severity,message,...(sectionId?{sectionId}:{}),...(courseCode?{courseCode}:{})});
  };
  if(solverStatus!=='COMPLETED')add('SOLVER_NOT_COMPLETED','Timefold has not completed successfully.');
  if(input.fixedGeneralStage)add('GENERAL_STAGE_ONLY','أوقات العامة مثبتة فقط؛ بناء جدول القسم والمدربين والمتدربين ينتظر تفاصيل المرحلة الثانية.');
  for(const code of input.scheduleRefinement?.requiredCourseCodes??[])if(result.sections.some(s=>s.courseCode===code&&s.state==='UNASSIGNED'))
    add('REQUIRED_COURSE_UNCOVERED','مقرر مطلوب تغطيته بالكامل غير مكتمل: '+code,undefined,code);
  for(const [id,hours] of Object.entries(input.scheduleRefinement?.requiredCreditedLoads??{})){
    const actual=result.sections.filter(s=>s.instructorId===id&&s.state!=='UNASSIGNED').reduce((n,s)=>n+s.creditedLoad,0);
    if(Math.abs(actual-hours)>1e-8)add('REQUIRED_INSTRUCTOR_LOAD',`المدرب ${id}: النصاب الفعلي ${actual}، والمطلوب ${hours}.`);
  }
  if(input.stableBlockPlan){
    try{validateStableBlocks(input);}catch(e){add('STABLE_BLOCK_SOURCE_INVALID',e instanceof Error?e.message:String(e));}
    for(const issue of stableBlockDiagnostics(input,result))add(issue.code,issue.message,undefined,issue.courseCode);
    for(const lock of stableGeneralLocks(input))for(const meeting of result.sessions)
      if(generalLockConflict(meeting,lock))add('GENERAL_COHORT_OR_RESOURCE_CONFLICT','تعارض مع '+lock.sourceItemId,meeting.sectionId,lock.courseCode);
  }
  if(input.generalCourseSchedule){
    try{validateGeneralSchedule(input);}catch(error){add('GENERAL_SOURCE_INVALID',error instanceof Error?error.message:'Invalid provisional source');}
    for(const lock of input.generalCourseSchedule.locks)for(const meeting of result.sessions)
      if(generalLockConflict(meeting,lock))add('GENERAL_COHORT_OR_RESOURCE_CONFLICT',
        'تعارض مع محاضرة عامة مبدئية: '+lock.sourceCells.join('، '),meeting.sectionId,lock.courseCode);
    if(input.generalCourseSchedule.planningAssumption)add('GENERAL_MAPPING_ASSUMED',
      'ربط مجموعات المقررات العامة افتراض تخطيطي بتوجيه المستخدم؛ قوائم المتدربين الرسمية غير متاحة.',undefined,undefined,'WARNING');
    if(input.generalCourseSchedule.issues.length)add('GENERAL_INTEGRATION_INCOMPLETE',
      'المقررات العامة مدمجة جزئيًا؛ توجد أوقات أو ساعات أو مجموعات أو موارد تحتاج استكمالًا. المسودة غير جاهزة للاعتماد.');
  }
  for(const code of input.policy.priorityCourseCodes??[]){
    const course=input.courses.find(course=>course.code===code);
    if(!course||course.demand===0)continue;
    const sections=result.sections.filter(section=>section.courseCode===code);
    if(course.assignmentScope==='EXTERNAL')add('PRIORITY_COURSE_EXTERNAL','مقرر أولوية التغطية مصنف بإسناد خارجي: '+course.title,undefined,code);
    else if(!sections.length||sections.some(section=>section.state==='UNASSIGNED'))
      add('PRIORITY_COURSE_UNCOVERED','لم تكتمل تغطية مقرر القسم ذي الأولوية: '+course.title,undefined,code);
  }
  if(result.externalSections?.length)add('EXTERNAL_ASSIGNMENT_PENDING',
    `${result.externalSections.length} شعبة عامة بانتظار إسناد خارجي؛ معروضة منفصلة عن عجز القسم ونصاب مدربيه.`,undefined,undefined,'WARNING');
  const externalCodes=new Set(input.courses.filter(course=>course.assignmentScope==='EXTERNAL').map(course=>course.code));
  if(result.sections.some(section=>externalCodes.has(section.courseCode))||result.gaps.some(gap=>externalCodes.has(gap.courseCode)))
    add('EXTERNAL_IN_DEPARTMENT_RESULT','المقررات الخارجية لا يجوز احتسابها ضمن شعب القسم أو عجزه.');
  if(input.policy.ignoreRoomCapacity)add('ROOM_CAPACITY_IGNORED','سعة القاعات غير مقيّدة في هذا السيناريو بقرار تخطيطي محلي.',undefined,undefined,'WARNING');
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
      const actual=sessions.reduce((sum,m)=>sum+trainingHours(m,input.policy),0);
      if(!Number.isFinite(actual)||Math.abs(actual-section.contactHours)>1e-8)add('INCOMPLETE_HOURS',
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
  for(const course of input.courses.filter(course=>course.assignmentScope!=='EXTERNAL')){
    if(!course.eligibleModes.includes(course.mode))
      add('COURSE_MODE_INELIGIBLE','Course '+course.code+' uses an unapproved delivery mode.',undefined,course.code);
  }
  const inside=(windows:Array<{day:string;from:number;to:number}>|undefined,meeting:Session)=>{
    return !windows || windows.some(w=>w.day===meeting.day&&w.from<=meeting.start&&w.to>=meeting.end);
  };
  const componentHours=(course:PlanRequest['courses'][number],sessions:Session[])=>{
    const sum=(component:'THEORY'|'PRACTICAL',mode:'ONSITE'|'REMOTE')=>
      sessions.filter(s=>s.component===component&&s.mode===mode).reduce((v,s)=>v+trainingHours(s,input.policy),0);
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
    const capacity=course?sectionCapacity(course,input.policy):null;
    if(capacity!==null&&section.students>capacity)
      add('SECTION_CAPACITY','Section exceeds its scenario course capacity.',section.id,section.courseCode);
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
      if(course && !trainerQualified(instructor,course))
        add('INELIGIBLE_INSTRUCTOR','Instructor is not eligible or conflicts with a locked assignment.',session.sectionId,session.courseCode);
      if(!inside(instructor.available,session))
        add('INSTRUCTOR_UNAVAILABLE','Session falls outside instructor availability.',session.sectionId,session.courseCode);
    }
    if(!course||!section||section.courseCode!==session.courseCode||section.blockId!==session.blockId||
      JSON.stringify(section.blockIds??[])!==JSON.stringify(session.blockIds??[]))
      add('SESSION_COHORT_MISMATCH','Course, section and block identity do not match.',session.sectionId,session.courseCode);
    const fixed=!!input.policy.lecturePeriods&&session.mode==='ONSITE';
    if(fixed?!validPeriodSession(session,input.policy)||!inside(input.policy.slots,session):
      !Number.isInteger(session.start*2)||!Number.isInteger(session.end*2)||
      session.start>=session.end || session.end-session.start>input.policy.sessionMaxHours ||
      !inside(input.policy.slots,session) ||
      (session.day==='THU'&&session.end>10))
      add('INVALID_TIME',fixed?'الجلسة خارج فترات المحاضرات المحفوظة أو مدتها لا تطابق الساعات التدريبية.':
        'Session is outside approved policy windows or half-hour granularity.',session.sectionId,session.courseCode);
    if(course && (course.mode==='SELF_PACED' ||
      (course.mode!=='HYBRID' && session.mode!==course.mode) ||
      (course.mode==='HYBRID' && (session.mode==='ONSITE'?session.end>12:session.start<16||session.end>22))))
      add('DELIVERY_MODE_VIOLATION','Session mode/time conflicts with approved delivery pattern.',session.sectionId,session.courseCode);
    if(session.mode==='ONSITE'){
      const room=session.roomId?roomMap.get(session.roomId):null;
      const students=section?.students??0;
      if(!room||(!input.policy.ignoreRoomCapacity&&(room.capacity===null||room.capacity<students)))
        add('ROOM_CAPACITY','Required room is missing or has insufficient capacity.',session.sectionId,session.courseCode);
      else if(!inside(room.available,session) || (course && !roomQualified(room,course,session.component,students,input.policy.ignoreRoomCapacity===true)))
        add('ROOM_INCOMPATIBLE','Room equipment/type or availability is unsuitable for component.',session.sectionId,session.courseCode);
    }else if(session.roomId!==null)
      add('REMOTE_ROOM','Remote session must not consume a physical room.',session.sectionId,session.courseCode);
  }
  for(let i=0;i<result.sessions.length;i++){
    const a=result.sessions[i]!;
    for(let j=i+1;j<result.sessions.length;j++){
      const b=result.sessions[j]!;
      if(!overlap(a,b))continue;
      const context=`${a.day} ${formatClock(a.start)}–${formatClock(a.end)} / ${formatClock(b.start)}–${formatClock(b.end)}، الجلسات ${a.id} / ${b.id}`;
      const reportBoth=(code:string,description:string,severity:'BLOCKER'|'WARNING'='BLOCKER')=>{
        add(code,description+' | '+context,a.sectionId,a.courseCode,severity);
        if(b.sectionId!==a.sectionId)add(code,description+' | '+context,b.sectionId,b.courseCode,severity);
      };
      if(a.instructorId===b.instructorId)
        reportBoth('TRAINER_COLLISION','Trainer '+a.instructorId+' is scheduled simultaneously');
      if(a.roomId!==null&&a.roomId===b.roomId)
        reportBoth('ROOM_OCCUPIED','Room '+a.roomId+' is occupied by overlapping sessions');
      if(hasSharedBlock(a,b)){
        if(cohortOverlapIsWarning(a,b,input.policy))
          reportBoth('ECONOMICS_COHORT_OVERLAP',`تداخل مقدمة الاقتصاد مع مقرر ${a.courseCode} / ${b.courseCode} للمتدربين أنفسهم؛ البلوك ${a.blockId} / ${b.blockId}. يسمح ببناء الجدول مع إظهار التداخل.`,'WARNING');
        else reportBoth('BLOCK_COLLISION','Cohort block '+a.blockId+' has another simultaneous class');
      }
      if(a.sectionId===b.sectionId)
        reportBoth('SECTION_COLLISION','The same section has simultaneous components');
      if(hardSessionConflict(a,b,input.policy))
        reportBoth('TIMETABLE_COLLISION','Conflicting meetings');
    }
  }
  for(const instructor of result.instructorLoads)
    if(instructor.remaining < -0.0001)add('LOAD_EXCEEDED',`Trainer ${instructor.id} exceeds credited load.`);
  for(const instructor of input.instructors){
    const target=instructor.teachingRules?.preferredCreditedLoad;
    const credited=result.sections.filter(section=>section.instructorId===instructor.id&&section.state!=='UNASSIGNED').reduce((n,section)=>n+section.creditedLoad,0);
    if(solverStatus==='COMPLETED'&&target!==undefined&&credited+1e-8<target)
      issues.push({code:'INSTRUCTOR_LOAD_TARGET',severity:'WARNING',instructorId:instructor.id,
        message:`المدرب ${instructor.name}: النصاب المغطى ${credited} من المستهدف ${target} ساعة؛ المتبقي ${Number((target-credited).toFixed(3))}.`});
    const totals=instructorTotals(instructor.id,result.sections);
    const actual=result.sessions.filter(session=>session.instructorId===instructor.id).reduce((sum,session)=>sum+session.end-session.start,0);
    if(exceedsTeachingLimits(instructor,totals.sections,Math.max(totals.contact,actual)))
      issues.push({code:'INSTRUCTOR_TEACHING_LIMIT',severity:'BLOCKER',instructorId:instructor.id,
        message:`المدرب ${instructor.id} تجاوز حد ساعات الجدول الفعلية أو عدد الشعب.`});
    if(solverStatus==='COMPLETED'&&totals.sections<(instructor.teachingRules?.preferredSections??0))
      add('INSTRUCTOR_SECTION_TARGET',`المدرب ${instructor.id}: أُسندت ${totals.sections} شعبة من العدد المستهدف ${instructor.teachingRules!.preferredSections}.`,undefined,undefined,'WARNING');
  }
  const m=result.metrics;
  if(Math.abs(m.assignedContactHours+m.uncoveredContactHours-m.requiredContactHours)>0.001)
    add('INCONSISTENT_TOTALS','Contact-hour totals do not reconcile.');
  const byCourse=input.courses.filter(course=>course.assignmentScope!=='EXTERNAL').map(course=>{
    const sections=result.sections.filter(s=>s.courseCode===course.code);
    return {code:course.code,title:course.title,demand:course.demand,
      sections:sections.length,uncovered:sections.filter(s=>s.state==='UNASSIGNED').length,
      missingBlocks:sections.filter(s=>s.students>0&&!s.blockId).length};
  });
  return {technicalReady:!issues.some(i=>i.severity==='BLOCKER'),issues,byCourse,
    status:solverStatus,sections:result.sections.length,meetings:result.sessions.length,
    uncoveredHours:m.uncoveredContactHours};
}
