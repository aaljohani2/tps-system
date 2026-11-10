import type {PlanRequest,PlanResult,Session} from './types.js';
import type {ReadinessIssue} from './api/readiness.js';
import {minutes} from './lecture-periods.js';
import {stableGeneralLocks,campusDays} from './stable-blocks.js';

export type ReportKind='instructors'|'trainees'|'rooms';
export interface ReportMetadata {scenarioId:string;scenarioName:string;state:string;solverStatus:string;revision:number;policyRevision:number;
 collegeName:string;departmentName:string;termLabel:string;termCode:string;generatedAt:string}
export interface ReportMeeting {id:string;courseCode:string;title:string;sectionId:string;sectionNumber:number;level:number;students:number;
 component:string;day:string;startMinute:number;endMinute:number;trainingHours:number;clockMinutes:number;instructor:string;room:string;roomCode:string;warning:boolean;
 sourceRef?:string;timingStatus?:string;mode?:'ONSITE'|'REMOTE';sectionLabel?:string}
export interface ReportPending {courseCode:string;title:string;sectionId:string;level:number;students:number;trainingHours:number;status:string}
export interface ReportEntity {id:string;title:string;level?:number;students?:number;members?:string[];notes:string[];
 meetings:ReportMeeting[];pending:ReportPending[];sectionCount:number;trainingHours:number;clockMinutes:number}
export interface ScenarioReport {version:1;kind:ReportKind;title:string;metadata:ReportMetadata;notes:string[];entities:ReportEntity[];
 externalDemandOnly?:boolean;
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
   mode:session.mode,warning:issues.some(issue=>issue.code==='ECONOMICS_COHORT_OVERLAP'&&issue.sectionId===section.id)};
 };
 const generalLocks=[...(input.generalCourseSchedule?.locks??[]),...stableGeneralLocks(input)];
 const generalMeetings:ReportMeeting[]=generalLocks.map(lock=>({id:lock.id,courseCode:lock.courseCode,
  title:courses.get(lock.courseCode)?.title??lock.courseCode,sectionId:lock.externalSectionId,
  sectionNumber:input.stableBlockPlan?0:Number(/-EXT-(\d+)$/.exec(lock.externalSectionId)?.[1]),
  ...(input.stableBlockPlan?{sectionLabel:`مجموعة مصدر ${input.stableBlockPlan.sourceRows.find(r=>r.id===lock.sourceItemId)?.sourceGroupNumber}؛ هوية الشعبة غير مثبتة`}:{}),level:lock.level,students:lock.students,component:'نظري عام',day:lock.day,
  startMinute:lock.startMinute,endMinute:lock.endMinute,trainingHours:lock.trainingHours,clockMinutes:lock.endMinute-lock.startMinute,
  instructor:lock.instructorId?(trainers.get(lock.instructorId)??lock.instructorId):lock.responsibleLabel+' (افتراضي)',
  room:lock.roomId?(rooms.get(lock.roomId)??lock.roomId):lock.mode==='REMOTE'?'عن بُعد':'لم تحدد من القسم المساند',roomCode:lock.roomId??(lock.mode==='REMOTE'?'عن بُعد':'غير محددة'),mode:lock.mode,warning:false,
  sourceRef:lock.sourceItemId,timingStatus:lock.mappingBasis==='USER_CONFIRMED_PLANNING_ASSUMPTION'?'مبدئي؛ ربط تخطيطي مفترض':'مبدئي؛ ربط موثق'}));
 const allMeetings=[...result.sessions.map(meeting),...generalMeetings].sort((a,b)=>dayOrder.indexOf(a.day)-dayOrder.indexOf(b.day)||a.startMinute-b.startMinute||a.courseCode.localeCompare(b.courseCode));
 const pending:ReportPending[]=[...result.gaps.map(gap=>({courseCode:gap.courseCode,title:courses.get(gap.courseCode)?.title??gap.courseCode,
  sectionId:gap.sectionId,level:gap.level,students:gap.students,trainingHours:gap.contactHours,status:'غير مغطى داخل القسم'})),
  ...(result.externalSections??[]).map(section=>({courseCode:section.courseCode,title:section.title,sectionId:section.id,level:section.level,
   students:section.students,trainingHours:section.contactHours,status:input.stableBlockPlan?'احتياج بلوك؛ ليس شعبة مصدر جديدة؛ التغطية غير مكتملة':input.generalCourseSchedule?
    `بانتظار استكمال الإسناد؛ مثبت ${(input.generalCourseSchedule.locks.filter(l=>l.externalSectionId===section.id).reduce((n,l)=>n+l.trainingHours,0))}/${section.contactHours} ساعة`:'بانتظار إسناد القسم المساند'}))];
 const finish=(base:Omit<ReportEntity,'sectionCount'|'trainingHours'|'clockMinutes'>):ReportEntity=>({...base,
  sectionCount:new Set(base.meetings.map(m=>m.sectionId)).size,trainingHours:base.meetings.reduce((n,m)=>n+m.trainingHours,0),clockMinutes:base.meetings.reduce((n,m)=>n+m.clockMinutes,0)});
 const notes=['الأوقات حسب بداية اللقاء، ووقت النهاية موضح داخل كل محاضرة.','الساعة التدريبية والوقت الفعلي يظهران بصورة مستقلة.'];
 if(input.stableBlockPlan)notes.push('مسودة غير مكتملة: العامة محفوظة كمصدر ثابت؛ كشف الاحتياج لا ينشئ شعبًا. سقف الشعبة عن بُعد 100. لا تقسيم إضافي لاستكمال الأنصبة. أيام القدوم أدناه محسوبة من اللقاءات معلومة المدة فقط؛ النواقص تمنع الاعتماد.');
 if(input.stableBlockPlan?.smallBlockClosure)notes.push('أُغلقت بلوكات القسم الصغيرة فقط: الثاني 43/43/43/43 والرابع 49/48. العامة محفوظة بمقاعدها الأصلية وبسقف 40؛ محاضراتها المدرجة تخص المقاعد الموروثة ولا تثبت تغطية جميع أفراد البلوك الأكبر. توزيع عضويات المتدربين المنقولين في العامة معلق؛ حجز الوقت تحفظي.');
 if(input.generalCourseSchedule){
  notes.push(`المقررات العامة مبدئية بتاريخ ${input.generalCourseSchedule.source.receivedAt}؛ ثبتت ${generalMeetings.length} محاضرة معلومة الوقت فقط. نهايات 01:40 والأوقات المسائية ناقصة المدة لم تخمن.`);
  notes.push('ربط مجموعات المصدر بمتدربينا افتراض تخطيطي بتوجيه المستخدم، وليس مطابقة قوائم رسمية. قسم الدراسات العامة جهة إسناد افتراضية وليس مدربًا واحدًا؛ القاعات والمدربون الخارجيون لم يحددوا.');
  notes.push('المسودة مدمجة جزئيًا وغير جاهزة للاعتماد؛ كل شعبة عامة واحتياجها محفوظان في كشف الاستكمال، بما فيها مقررات الحاسب غير الواردة في التعميم.');
 }
 notes.push(...(input.projection?.assumptions.filter(note=>note.startsWith('أعيد تقسيم'))??[]));
 if(input.projection?.key==='CAP_100_50_40')notes.push(...input.projection.assumptions.filter(note=>note.startsWith('أعيد توزيع')));
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
 if(kind==='instructors'&&generalMeetings.length)entities.push(finish({id:'GENERAL_STUDIES',title:'قسم الدراسات العامة - إسناد افتراضي',
  notes:['كشف مجمع لمحاضرات القسم المساند، وليس جدول مدرب واحد. قد تتزامن شعب مختلفة ويحتاج تحديد مدربيها الحقيقيين. خارج نصاب مدربي القسم الأكاديمي المعني.'],meetings:generalMeetings,pending:[]}));
 if(kind==='rooms')entities=input.rooms.map(room=>finish({id:room.id,title:rooms.get(room.id)!,
  notes:room.type===null?['نوع المرفق غير مصنف؛ لا يستخدم في الجدولة.']:[],
  meetings:allMeetings.filter(m=>m.roomCode===room.id),pending:[]}));
 if(kind==='trainees'){
  notes.push('المجموعات أدناه تجمع المتدربين المشتركين في الشعب نفسها؛ لا تمثل قائمة بأسماء المتدربين أو أرقام شعب رايات.');
  if(!input.cohortBlocks?.length)notes.push('هذه اللقطة لا تحتوي عضويات بلوكات موثقة؛ لا يمكن استخراج جدول شخصي موحد من المستوى وحده.');
  const groups=new Map<string,{level:number;students:number;members:string[];sectionIds:string[];externalIds:string[]}>();
  for(const block of input.cohortBlocks??[]){
   const sectionIds=result.sections.filter(s=>(s.blockIds??(s.blockId?[s.blockId]:[])).includes(block.ref)).map(s=>s.id).sort();
   const externalIds=(result.externalSections??[]).filter(s=>s.blockIds.includes(block.ref)).map(s=>s.id).sort();
   const signature=JSON.stringify([block.level,sectionIds,externalIds,...(input.stableBlockPlan?[block.ref]:[])]);
   const group=groups.get(signature)??{level:block.level,students:0,members:[],sectionIds,externalIds};
   group.students+=block.size;group.members.push(block.ref);groups.set(signature,group);
  }
  const counters=new Map<number,number>();
  entities=[...groups.values()].sort((a,b)=>a.level-b.level||a.members[0]!.localeCompare(b.members[0]!,undefined,{numeric:true})).map(group=>{
   const index=(counters.get(group.level)??0)+1;counters.set(group.level,index);
   return finish({id:`L${group.level}-G${String(index).padStart(2,'0')}`,title:`المستوى ${group.level} - المجموعة ${index}`,
    level:group.level,students:group.students,members:group.members,notes:input.stableBlockPlan?(()=>{
      const row=campusDays(input,result.sessions).find(b=>group.members.includes(b.blockId))!;
      const labels:Record<string,string>={SUN:'الأحد',MON:'الاثنين',TUE:'الثلاثاء',WED:'الأربعاء',THU:'الخميس'};
      return [`أيام القدوم للكلية: ${row.campusDayCount} (${row.campusDays.map(d=>labels[d]).join('، ')||'لا يوجد'})؛ أيام عن بُعد: ${row.remoteDays.map(d=>labels[d]).join('، ')||'لا يوجد موثق'}.`,`البلوك ${group.members.join('، ')}؛ التغطية غير مكتملة، وعدد أيام القدوم يعكس اللقاءات الموثقة فقط.`,
       ...(input.stableBlockPlan!.smallBlockClosure&&[2,4].includes(group.level)?['شعب العامة وأعداد مقاعدها الأصلية ثابتة؛ توزيع المتدربين المنقولين في العامة معلق، ولا تعني المحاضرات المدرجة تغطية كامل هذا البلوك.']:[])];
    })():[],
    meetings:allMeetings.filter(m=>group.sectionIds.includes(m.sectionId)||group.externalIds.includes(m.sectionId)||generalLocks.some(l=>l.id===m.id&&l.blockIds.some(id=>group.members.includes(id)))),
    pending:pending.filter(p=>group.sectionIds.includes(p.sectionId)||group.externalIds.includes(p.sectionId))});
  });
  if(input.projection?.cooperativeStudents)entities.push(finish({id:'COOP',title:'المستوى 5 - التدريب التعاوني',level:5,
   students:input.projection.cooperativeStudents,notes:['تدريب تعاوني خارج المحاضرات الأسبوعية. مجموعات الإشراف والجهات لم تحدد بعد.'],meetings:[],pending:[]}));
 }
 if(entities.length>500)throw new Error('Report exceeds the 500-entity local export limit');
 const studentCount=kind==='trainees'&&input.cohortBlocks?.length?entities.reduce((n,e)=>n+(e.students??0),0):null;
 return {version:1,kind,title:names[kind],metadata,notes,entities,pending,...(input.stableBlockPlan?{externalDemandOnly:true}:{}),
  summary:{departmentSections:result.sections.length,scheduledSections:result.sections.filter(s=>s.state==='SCHEDULED').length,
   gaps:result.gaps.length,externalSections:result.externalSections?.length??0,studentCount,warnings:issues.filter(i=>i.severity==='WARNING').length},
  issues:issues.filter(issue=>!['EXTERNAL_ASSIGNMENT_PENDING','ROOM_CAPACITY_IGNORED','UNCOVERED_SECTION','NO_FEASIBLE_TIMETABLE',
   'NO_ELIGIBLE_INSTRUCTOR','LOAD_LIMIT','SELF_PACED_NO_LOAD_POLICY'].includes(issue.code)).map(({code,severity,message})=>({code,severity,message}))};
}
