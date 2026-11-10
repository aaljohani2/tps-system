import type {PlanRequest,PlanResult,Session} from './types.js';
import type {ReadinessIssue} from './api/readiness.js';
import {minutes} from './lecture-periods.js';

export type ReportKind='instructors'|'trainees'|'rooms';
export interface ReportMetadata {scenarioId:string;scenarioName:string;state:string;solverStatus:string;revision:number;policyRevision:number;
 collegeName:string;departmentName:string;termLabel:string;termCode:string;generatedAt:string}
export interface ReportMeeting {id:string;courseCode:string;title:string;sectionId:string;sectionNumber:number;level:number;students:number;
 component:string;day:string;startMinute:number;endMinute:number;trainingHours:number;clockMinutes:number;instructor:string;room:string;roomCode:string;warning:boolean}
export interface ReportPending {courseCode:string;title:string;sectionId:string;level:number;students:number;trainingHours:number;status:string}
export interface ReportEntity {id:string;title:string;level?:number;students?:number;members?:string[];notes:string[];
 meetings:ReportMeeting[];pending:ReportPending[];sectionCount:number;trainingHours:number;clockMinutes:number}
export interface ScenarioReport {version:1;kind:ReportKind;title:string;metadata:ReportMetadata;notes:string[];entities:ReportEntity[];
 summary:{departmentSections:number;scheduledSections:number;gaps:number;externalSections:number;studentCount:number|null;warnings:number};
 pending:ReportPending[];issues:Array<{code:string;severity:string;message:string}>}
const names={instructors:'جداول المدربين',trainees:'جداول المتدربين',rooms:'جداول القاعات'};
const dayOrder=['SUN','MON','TUE','WED','THU'];

/** Report only saved assignments. Shared student membership is never inferred from level alone. */
export function buildScenarioReport(input:PlanRequest,result:PlanResult,metadata:ReportMetadata,kind:ReportKind,issues:ReadinessIssue[]):ScenarioReport{
 const courses=new Map(input.courses.map(c=>[c.code,c])),sections=new Map(result.sections.map(s=>[s.id,s]));
 const trainers=new Map(input.instructors.map(i=>[i.id,`${i.name} (${i.id})`])),rooms=new Map(input.rooms.map(r=>[r.id,`${r.name} (${r.id})`]));
 const meeting=(session:Session):ReportMeeting=>{
  const section=sections.get(session.sectionId),course=courses.get(session.courseCode);
  if(!section||!course)throw new Error('Saved session has no matching course/section');
  return {id:session.id,courseCode:course.code,title:course.title,sectionId:section.id,sectionNumber:section.index,level:section.level,students:section.students,
   component:session.component==='PRACTICAL'?'عملي':'نظري',day:session.day,startMinute:minutes(session.start),endMinute:minutes(session.end),
   trainingHours:session.trainingHours??session.end-session.start,clockMinutes:minutes(session.end)-minutes(session.start),
   instructor:trainers.get(session.instructorId)??session.instructorId,room:session.roomId?(rooms.get(session.roomId)??session.roomId):'عن بُعد',roomCode:session.roomId??'عن بُعد',
   warning:issues.some(issue=>issue.code==='ECONOMICS_COHORT_OVERLAP'&&issue.sectionId===section.id)};
 };
 const allMeetings=result.sessions.map(meeting).sort((a,b)=>dayOrder.indexOf(a.day)-dayOrder.indexOf(b.day)||a.startMinute-b.startMinute||a.courseCode.localeCompare(b.courseCode));
 const pending:ReportPending[]=[...result.gaps.map(gap=>({courseCode:gap.courseCode,title:courses.get(gap.courseCode)?.title??gap.courseCode,
  sectionId:gap.sectionId,level:gap.level,students:gap.students,trainingHours:gap.contactHours,status:'غير مغطى داخل القسم'})),
  ...(result.externalSections??[]).map(section=>({courseCode:section.courseCode,title:section.title,sectionId:section.id,level:section.level,
   students:section.students,trainingHours:section.contactHours,status:'بانتظار إسناد القسم المساند'}))];
 const finish=(base:Omit<ReportEntity,'sectionCount'|'trainingHours'|'clockMinutes'>):ReportEntity=>({...base,
  sectionCount:new Set(base.meetings.map(m=>m.sectionId)).size,trainingHours:base.meetings.reduce((n,m)=>n+m.trainingHours,0),clockMinutes:base.meetings.reduce((n,m)=>n+m.clockMinutes,0)});
 const notes=['الأوقات حسب بداية اللقاء، ووقت النهاية موضح داخل كل محاضرة.','الساعة التدريبية والوقت الفعلي يظهران بصورة مستقلة.'];
 notes.push(...(input.projection?.assumptions.filter(note=>note.startsWith('أعيد تقسيم'))??[]));
 for(const instructor of input.instructors.filter(instructor=>instructor.teachingRules?.preferredCreditedLoad!==undefined)){
  const assigned=result.instructorLoads.find(load=>load.id===instructor.id)?.credited??0;
  notes.push(`${instructor.name}: النصاب المحتسب ${assigned} من المستهدف ${instructor.teachingRules!.preferredCreditedLoad} ساعة، والعملي البحت ${instructor.teachingRules!.allowedCourseTypes?.includes('PRACTICAL')?'مسموح':'غير مسموح'}.`);
 }
 for(const code of input.policy.priorityCourseCodes??[]){
  const course=courses.get(code);if(!course)continue;
  const required=result.sections.filter(section=>section.courseCode===code),covered=required.filter(section=>section.state!=='UNASSIGNED').length;
  notes.push(`${course.title}: إسناد داخل القسم، مغطى ${covered} من ${required.length} شعبة.`);
 }
 let entities:ReportEntity[]=[];
 if(kind==='instructors')entities=input.instructors.map(instructor=>finish({id:instructor.id,title:trainers.get(instructor.id)!,
  notes:[],meetings:allMeetings.filter(m=>result.sessions.find(s=>s.id===m.id)?.instructorId===instructor.id),pending:[]}));
 if(kind==='rooms')entities=input.rooms.map(room=>finish({id:room.id,title:rooms.get(room.id)!,
  notes:room.type===null?['نوع المرفق غير مصنف؛ لا يستخدم في الجدولة.']:[],
  meetings:allMeetings.filter(m=>result.sessions.find(s=>s.id===m.id)?.roomId===room.id),pending:[]}));
 if(kind==='trainees'){
  notes.push('المجموعات أدناه تجمع المتدربين المشتركين في الشعب نفسها؛ لا تمثل قائمة بأسماء المتدربين أو أرقام شعب رايات.');
  if(!input.cohortBlocks?.length)notes.push('هذه اللقطة لا تحتوي عضويات بلوكات موثقة؛ لا يمكن استخراج جدول شخصي موحد من المستوى وحده.');
  const groups=new Map<string,{level:number;students:number;members:string[];sectionIds:string[];externalIds:string[]}>();
  for(const block of input.cohortBlocks??[]){
   const sectionIds=result.sections.filter(s=>(s.blockIds??(s.blockId?[s.blockId]:[])).includes(block.ref)).map(s=>s.id).sort();
   const externalIds=(result.externalSections??[]).filter(s=>s.blockIds.includes(block.ref)).map(s=>s.id).sort();
   const signature=JSON.stringify([block.level,sectionIds,externalIds]);
   const group=groups.get(signature)??{level:block.level,students:0,members:[],sectionIds,externalIds};
   group.students+=block.size;group.members.push(block.ref);groups.set(signature,group);
  }
  const counters=new Map<number,number>();
  entities=[...groups.values()].sort((a,b)=>a.level-b.level||a.members[0]!.localeCompare(b.members[0]!,undefined,{numeric:true})).map(group=>{
   const index=(counters.get(group.level)??0)+1;counters.set(group.level,index);
   return finish({id:`L${group.level}-G${String(index).padStart(2,'0')}`,title:`المستوى ${group.level} - المجموعة ${index}`,
    level:group.level,students:group.students,members:group.members,notes:[],
    meetings:allMeetings.filter(m=>group.sectionIds.includes(m.sectionId)),
    pending:pending.filter(p=>group.sectionIds.includes(p.sectionId)||group.externalIds.includes(p.sectionId))});
  });
  if(input.projection?.cooperativeStudents)entities.push(finish({id:'COOP',title:'المستوى 5 - التدريب التعاوني',level:5,
   students:input.projection.cooperativeStudents,notes:['تدريب تعاوني خارج المحاضرات الأسبوعية. مجموعات الإشراف والجهات لم تحدد بعد.'],meetings:[],pending:[]}));
 }
 if(entities.length>500)throw new Error('Report exceeds the 500-entity local export limit');
 const studentCount=kind==='trainees'&&input.cohortBlocks?.length?entities.reduce((n,e)=>n+(e.students??0),0):null;
 return {version:1,kind,title:names[kind],metadata,notes,entities,pending,
  summary:{departmentSections:result.sections.length,scheduledSections:result.sections.filter(s=>s.state==='SCHEDULED').length,
   gaps:result.gaps.length,externalSections:result.externalSections?.length??0,studentCount,warnings:issues.filter(i=>i.severity==='WARNING').length},
  issues:issues.filter(issue=>!['EXTERNAL_ASSIGNMENT_PENDING','ROOM_CAPACITY_IGNORED','UNCOVERED_SECTION','NO_FEASIBLE_TIMETABLE',
   'NO_ELIGIBLE_INSTRUCTOR','LOAD_LIMIT','SELF_PACED_NO_LOAD_POLICY'].includes(issue.code)).map(({code,severity,message})=>({code,severity,message}))};
}
