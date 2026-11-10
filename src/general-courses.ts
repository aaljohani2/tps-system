import type {Day,PlanRequest,Session} from './types.js';
import {hasSharedBlock} from './cohort-grouping.js';
import {normalizeArabic} from './automatic-planning.js';
import {stableGeneralLocks,violatesStableRules} from './stable-blocks.js';

export interface GeneralSourceItem {
 id:string;sheet:string;level:number;sourceGroup:string;sourceGroupNumber:number;headerCell:string;sourceCells:string[];
 rawTitle:string;normalizedTitle:string;kind:'DAY'|'EVENING'|'SELF_PACED'|'CANCELLED';day:Day|null;
 literalStartMinute:number|null;literalEndMinute:number|null;startMinute:number|null;endMinute:number|null;
 timingStatus:string;identifiersUnverified:string[];relation:string;
}
export interface GeneralMapping extends GeneralSourceItem {
 courseCode:string|null;externalSectionId:string|null;blockIds:string[];
 matchStatus:'VERIFIED'|'POSSIBLE'|'UNMATCHED'|'CONFLICTED';
 basis:'USER_CONFIRMED_PLANNING_ASSUMPTION'|'TITLE_LEVEL_CANDIDATE'|'OUT_OF_SCOPE'|'UNRESOLVED';
 evidence:string;constraintStatus:'PROVISIONAL_LOCKED'|'PENDING'|'NOT_A_MEETING';
}
export interface GeneralLock {
 id:string;sourceItemId:string;externalSectionId:string;courseCode:string;level:number;students:number;
 blockIds:string[];day:Day;startMinute:number;endMinute:number;trainingHours:number;mode:'ONSITE'|'REMOTE';
 instructorId:string|null;roomId:string|null;responsibleLabel:string;
 status:'PROVISIONAL_LOCKED';sourceCells:string[];mappingBasis:GeneralMapping['basis'];
}
export interface GeneralCourseSchedule {
 version:1;baselineScenarioId:string;status:'PROVISIONAL';
 source:{file:string;sha256:string;receivedAt:string};
 planningAssumption:string|null;mappings:GeneralMapping[];locks:GeneralLock[];
 issues:Array<{code:string;message:string;sourceItemId?:string;courseCode?:string;externalSectionId?:string}>;
}

const key=(text:string)=>normalizeArabic(text).replace(/\b\d{4,}\b/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** Title/level resolves candidates only. A source ordinal alone never proves a real roster. */
export function generalCourseCandidate(item:GeneralSourceItem,input:PlanRequest):string|null {
 if(item.sheet!=='الإدارة'||item.kind==='CANCELLED')return null;
 const title=key(item.rawTitle);let code:string|undefined;
 if(/انجليزي|انجليز|انجليسي/.test(title)){
  const explicit=/(?:انجليزي|انجليز|انجليسي)\s*([123])/.exec(title);
  const level=explicit?Number(explicit[1]):item.level;
  if(level>=1&&level<=3)code=['انجل-111','انجل-112','انجل-113'][level-1];
 }else if(/كتابه فنيه|مهارات عربيه|لغه عربيه/.test(title))code='عربي-101';
 else if(/رياضيات/.test(title))code='رياض-101';
 else if(/احصاء|احصا/.test(title))code='احصا-101';
 else if(/رياد/.test(title)&&!/مجال.*ادار/.test(title))code='رياد-101';
 else if(/دراسات اسلاميه|ثقافه اسلاميه/.test(title))code='اسلم-101';
 else if(/سلوك وظيفي/.test(title))code='اسلك-201';
 const course=input.courses.find(c=>c.code===code&&c.level===item.level&&c.assignmentScope==='EXTERNAL');
 return course?.code??null;
}

export function mapGeneralCourses(input:PlanRequest,items:GeneralSourceItem[],source:GeneralCourseSchedule['source'],
 baselineScenarioId:string,planningAssumption:string|null=null):GeneralCourseSchedule {
 const issues:GeneralCourseSchedule['issues']=[],locks:GeneralLock[]=[],mappings:GeneralMapping[]=[];
 for(const item of items){
  const code=generalCourseCandidate(item,input),course=input.courses.find(c=>c.code===code);
  const ordinal=item.sourceGroupNumber-1;
  const members=course?.blockGroups?.[ordinal]??(course?.blocks?.[ordinal]?[course.blocks[ordinal]!]:undefined);
  const sectionId=members&&code?`${code}-EXT-${String(ordinal+1).padStart(3,'0')}`:null;
  const assumed=!!planningAssumption&&!!members&&!!course;
  const mapping:GeneralMapping={...item,sourceCells:[...item.sourceCells],courseCode:code,externalSectionId:sectionId,
   blockIds:members??[],matchStatus:code?'POSSIBLE':'UNMATCHED',
   basis:item.sheet!=='الإدارة'?'OUT_OF_SCOPE':assumed?'USER_CONFIRMED_PLANNING_ASSUMPTION':code?'TITLE_LEVEL_CANDIDATE':'UNRESOLVED',
   evidence:assumed?'ربط تخطيطي بتوجيه المستخدم: ترتيب مجموعات المصدر مع شعب المقرر الخارجي ذات السعة 40، دون ادعاء تطابق قوائم رسمية.':
    item.sheet!=='الإدارة'?'ورقة تخصص آخر؛ لم تغير مقررات القسم الآخر.':code?'العنوان والمستوى يطابقان مرشحًا في الخطة؛ عضويات المصدر غير مثبتة.':'لا يوجد مقرر خارجي مطابق في خطة هذا المستوى.',
   constraintStatus:item.kind==='CANCELLED'||item.kind==='SELF_PACED'?'NOT_A_MEETING':'PENDING'};
  if(item.sheet==='الإدارة'&&item.kind!=='CANCELLED'){
   if(!assumed)issues.push({code:'GENERAL_MAPPING_UNCONFIRMED',message:'عضويات مجموعة المصدر غير مثبتة أو خارج عدد شعب المقرر.',sourceItemId:item.id});
   if(item.kind==='EVENING')issues.push({code:'GENERAL_EVENING_UNRESOLVED',message:'وقت مسائي دون نهاية أو نمط مثبت، وعلاقته بالنهاري غير محسومة؛ لم يتكرر الاحتياج.',sourceItemId:item.id});
   if(item.kind==='SELF_PACED')issues.push({code:'GENERAL_MODE_UNRESOLVED',message:'ذاتي في المصدر؛ لم يتحول إلى حضور أو ساعات منجزة دون اعتماد نمط المقرر.',sourceItemId:item.id});
   if(item.kind==='DAY'&&(item.startMinute===null||item.endMinute===null||!item.day))issues.push({code:'GENERAL_TIME_UNRESOLVED',message:'فترة غير مكتملة أو نهاية 01:40 لم تحول تلقائيًا إلى 13:40.',sourceItemId:item.id});
   if(assumed&&item.kind==='DAY'&&item.day&&item.startMinute!==null&&item.endMinute!==null){
    const duration=item.endMinute-item.startMinute,unit=input.policy.lecturePeriods?.academicHourMinutes??60;
    const hours=duration/unit,expected=course!.theoryHours+course!.practicalHours;
    const delivered=locks.filter(l=>l.externalSectionId===sectionId).reduce((n,l)=>n+l.trainingHours,0);
    const onsite=course!.mode==='ONSITE'&&input.policy.slots.some(w=>w.day===item.day&&w.from*60<=item.startMinute!&&w.to*60>=item.endMinute!);
    if(Number.isInteger(hours)&&hours>0&&delivered+hours<=expected&&onsite){
     mapping.constraintStatus='PROVISIONAL_LOCKED';
     locks.push({id:`GENERAL:${item.id}`,sourceItemId:item.id,externalSectionId:sectionId!,courseCode:code!,level:item.level,
      students:course!.blockSizes![ordinal]!,blockIds:[...members!],day:item.day,startMinute:item.startMinute,endMinute:item.endMinute,
      trainingHours:hours,mode:'ONSITE',instructorId:null,roomId:null,responsibleLabel:'قسم الدراسات العامة',
      status:'PROVISIONAL_LOCKED',sourceCells:[...item.sourceCells],mappingBasis:'USER_CONFIRMED_PLANNING_ASSUMPTION'});
    }else{
     mapping.matchStatus='CONFLICTED';issues.push({code:'GENERAL_HOURS_OR_MODE_CONFLICT',message:'المدة أو النمط أو وقت تشغيل الكلية أو مجموع الساعات لا يطابق الخطة؛ لم تثبت المحاضرة.',sourceItemId:item.id});
    }
   }
  }
  mappings.push(mapping);
 }
 // Day/evening mentions of one offering are candidate relationships, not additional demand.
 for(const mapping of mappings)if(mappings.some(other=>other.id!==mapping.id&&other.courseCode&&other.courseCode===mapping.courseCode&&
  other.sourceGroup===mapping.sourceGroup&&(other.kind==='EVENING'||mapping.kind==='EVENING')))mapping.relation='UNRESOLVED_DAY_EVENING';
 for(const course of input.courses.filter(c=>c.assignmentScope==='EXTERNAL'))for(let index=0;index<(course.blockSizes?.length??0);index++){
  const id=`${course.code}-EXT-${String(index+1).padStart(3,'0')}`,required=course.theoryHours+course.practicalHours;
  const documented=locks.filter(l=>l.externalSectionId===id).reduce((n,l)=>n+l.trainingHours,0);
  if(documented<required)issues.push({code:'GENERAL_HOURS_PENDING',courseCode:course.code,externalSectionId:id,
   message:`${course.title}: شعبة ${index+1} تحتاج ${required} ساعات؛ ثبت تخطيطيًا ${documented}، والمتبقي ${required-documented}.`});
 }
 if(locks.length)issues.push({code:'GENERAL_RESOURCES_PENDING',message:'قسم الدراسات العامة جهة إسناد افتراضية وليس مدربًا واحدًا؛ أسماء المدربين والقاعات الخارجية غير متاحة ولا يمكن إثبات خلوها من التعارض.'});
 return {version:1,baselineScenarioId,status:'PROVISIONAL',source,planningAssumption,mappings,locks,issues};
}

/** Economics overlap permission never exempts a fixed general-course collision. */
export function generalLockConflict(session:Session,lock:GeneralLock):boolean {
 return session.day===lock.day&&Math.round(session.start*60)<lock.endMinute&&lock.startMinute<Math.round(session.end*60)&&(
  hasSharedBlock(session,{blockId:null,blockIds:lock.blockIds})||!!lock.instructorId&&session.instructorId===lock.instructorId||
  !!lock.roomId&&session.roomId===lock.roomId);
}
export function conflictsWithGeneral(input:PlanRequest,sessions:Session[]):boolean {
 return violatesStableRules(input,sessions)||sessions.some(session=>[...(input.generalCourseSchedule?.locks??[]),...stableGeneralLocks(input)].some(lock=>generalLockConflict(session,lock)));
}
/** Compile fixed source facts once per placement search; snapshots remain free of mutable global caches. */
export function generalConstraintCheck(input:PlanRequest):(sessions:Session[])=>boolean {
 const locks=[...(input.generalCourseSchedule?.locks??[]),...stableGeneralLocks(input)];
 const fixedDays=new Map<string,Set<string>>();
 for(const lock of locks.filter(l=>l.mode==='ONSITE'))for(const id of lock.blockIds){
  if(!fixedDays.has(id))fixedDays.set(id,new Set());fixedDays.get(id)!.add(lock.day);
 }
 return sessions=>{
  if(sessions.some(session=>locks.some(lock=>generalLockConflict(session,lock))))return true;
  if(!input.stableBlockPlan)return false;
  const byBlock=new Map([...fixedDays].map(([id,value])=>[id,new Set(value)]));
  for(const session of sessions){
   if(session.day==='THU')return true;
   if(session.mode!=='ONSITE')continue;
   for(const id of session.blockIds??(session.blockId?[session.blockId]:[])){
    if(!byBlock.has(id))byBlock.set(id,new Set());byBlock.get(id)!.add(session.day);
    if(byBlock.get(id)!.size>2)return true;
   }
  }
  return [...byBlock.values()].some(value=>value.size>2);
 };
}
export function validateGeneralSchedule(input:PlanRequest):void {
 const schedule=input.generalCourseSchedule;if(!schedule)return;
 if(schedule.version!==1||schedule.status!=='PROVISIONAL'||!schedule.baselineScenarioId||
  !/^[a-f0-9]{64}$/.test(schedule.source?.sha256)||!schedule.source?.file||!/^\d{4}-\d{2}-\d{2}$/.test(schedule.source?.receivedAt)||
  !Array.isArray(schedule.mappings)||schedule.mappings.length>2000||!Array.isArray(schedule.locks)||schedule.locks.length>500||
  !Array.isArray(schedule.issues))throw Error('Invalid general-course source metadata');
 const seen=new Set<string>();
 for(const lock of schedule.locks){
  const mapping=schedule.mappings.find(m=>m.id===lock.sourceItemId),course=input.courses.find(c=>c.code===lock.courseCode);
  const index=Number(/-EXT-(\d+)$/.exec(lock.externalSectionId)?.[1])-1;
  const members=course?.blockGroups?.[index]??(course?.blocks?.[index]?[course.blocks[index]!]:[]);
  if(seen.has(lock.id)||!mapping||mapping.constraintStatus!=='PROVISIONAL_LOCKED'||
   !(mapping.matchStatus==='VERIFIED'||mapping.basis==='USER_CONFIRMED_PLANNING_ASSUMPTION'&&!!schedule.planningAssumption)||
   mapping.externalSectionId!==lock.externalSectionId||mapping.courseCode!==lock.courseCode||mapping.kind!=='DAY'||
   mapping.startMinute!==lock.startMinute||mapping.endMinute!==lock.endMinute||mapping.day!==lock.day||
   lock.status!=='PROVISIONAL_LOCKED'||!mapping.sourceCells.length||JSON.stringify(mapping.sourceCells)!==JSON.stringify(lock.sourceCells)||
   !course||course.assignmentScope!=='EXTERNAL'||course.level!==lock.level||lock.externalSectionId!==`${course.code}-EXT-${String(index+1).padStart(3,'0')}`||
   course.blockSizes?.[index]!==lock.students||lock.students>course.sectionCapacity!||
   !members.length||new Set(lock.blockIds).size!==members.length||members.some(id=>!lock.blockIds.includes(id))||
   !['SUN','MON','TUE','WED','THU'].includes(lock.day)||!Number.isInteger(lock.startMinute)||!Number.isInteger(lock.endMinute)||
   lock.startMinute<0||lock.endMinute>1440||lock.endMinute<=lock.startMinute||
   lock.mode!=='ONSITE'||course.mode!=='ONSITE'||!Number.isInteger(lock.trainingHours)||lock.trainingHours<=0||
   lock.endMinute-lock.startMinute!==lock.trainingHours*(input.policy.lecturePeriods?.academicHourMinutes??60)||
   !input.policy.slots.some(w=>w.day===lock.day&&w.from*60<=lock.startMinute&&w.to*60>=lock.endMinute)||
   lock.instructorId!==null&&!input.instructors.some(i=>i.id===lock.instructorId)||lock.roomId!==null&&!input.rooms.some(r=>r.id===lock.roomId))
   throw Error('Invalid, unconfirmed or stale general-course lock: '+lock.id);
  seen.add(lock.id);
 }
 for(const course of input.courses.filter(c=>c.assignmentScope==='EXTERNAL'))for(let i=0;i<(course.blockSizes?.length??0);i++){
  const id=`${course.code}-EXT-${String(i+1).padStart(3,'0')}`;
  if(schedule.locks.filter(l=>l.externalSectionId===id).reduce((n,l)=>n+l.trainingHours,0)>course.theoryHours+course.practicalHours)
   throw Error('General-course hours exceed curriculum: '+id);
 }
 for(let i=0;i<schedule.locks.length;i++)for(let j=i+1;j<schedule.locks.length;j++){
  const a=schedule.locks[i]!,b=schedule.locks[j]!;
  if(a.day===b.day&&a.startMinute<b.endMinute&&b.startMinute<a.endMinute&&(
   a.externalSectionId===b.externalSectionId||a.blockIds.some(id=>b.blockIds.includes(id))||
   !!a.instructorId&&a.instructorId===b.instructorId||!!a.roomId&&a.roomId===b.roomId))throw Error('Conflicting fixed general-course source meetings');
 }
}
