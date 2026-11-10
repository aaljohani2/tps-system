import type {Course,PlanRequest,PlanResult} from './types.js';
import {courseType} from './instructor-rules.js';
import {trainerQualified} from './eligibility.js';
import {validateRequest} from './validation.js';

export type EconomicsAssignment='KEEP_WITH_ANS'|'MOVE_TO_FAHAD_MOHAMMED';
const abdullahCodes=['ادار-101','رياد-262'];
const internal=(c:Course)=>c.assignmentScope!=='EXTERNAL';
const sectionHours=(c:Course)=>(c.blockSizes?.length??0)*(c.theoryHours+c.practicalHours);

/** Latest user request: copy enrolment groups only; course hours, modes and teacher ownership stay authoritative. */
export function matchPrinciplesEconomicsSections(source:PlanRequest):PlanRequest {
 validateRequest(source);
 if(!source.stableBlockPlan)throw Error('Stable-block source required');
 const input=structuredClone(source),principles=input.courses.find(c=>c.code==='ادار-101'),economics=input.courses.find(c=>c.code==='اقصد-101');
 if(!principles||!economics||!internal(principles)||!internal(economics)||principles.level!==economics.level||principles.demand!==economics.demand||
  !economics.blockGroups?.length||!economics.blockSizes?.length||!economics.blocks?.length)throw Error('Verified matching Economics enrolment groups required');
 const previous=principles.blockGroups?.length??0;
 principles.blocks=[...economics.blocks];principles.blockSizes=[...economics.blockSizes];principles.blockGroups=economics.blockGroups.map(g=>[...g]);
 principles.assignedInstructorId='4';principles.exclusiveInstructor=true;
 input.stableBlockPlan!.departmentSectionCounts['ادار-101']=principles.blockGroups.length;
 input.stableBlockPlan!.principlesEconomicsAlignment={reason:'USER_REQUEST_MATCH_ECONOMICS',previousPrinciplesSectionCount:source.stableBlockPlan.principlesEconomicsAlignment?.previousPrinciplesSectionCount??previous,referenceSectionCount:principles.blockGroups.length};
 const reserved=input.courses.filter(c=>c.assignedInstructorId==='4'&&internal(c)).reduce((n,c)=>n+sectionHours(c),0),trainer=input.instructors.find(i=>i.id==='4');
 if(!trainer||reserved>trainer.maxLoad+(trainer.overload?.additionalHours??0))throw Error('Requested enrolment alignment exceeds Abdullah load limit');
 const refinement=input.scheduleRefinement;
 if(refinement){
  for(const id of Object.keys(refinement.referenceInstructors))if(id.startsWith('ادار-101-'))delete refinement.referenceInstructors[id];
  for(let i=0;i<principles.blockGroups.length;i++)refinement.referenceInstructors[`ادار-101-${String(i+1).padStart(3,'0')}`]='4';
  refinement.referenceSessions=refinement.referenceSessions.filter(s=>s.courseCode!=='ادار-101');
  if(refinement.initialSessions)refinement.initialSessions=refinement.initialSessions.filter(s=>s.courseCode!=='ادار-101');
  refinement.requiredCourseCodes=[...new Set([...(refinement.requiredCourseCodes??[]),'ادار-101','رياد-262','اقصد-101'])];
  if(refinement.requiredCreditedLoads)refinement.requiredCreditedLoads['4']=reserved;
 }
 input.projection?.assumptions.push('بتوجيه المستخدم: أعداد شعب مبادئ الإدارة وعضوياتها مطابقة للاقتصاد، مع بقاء أربع ساعات منهج للمقرر وإسناده لعبدالله. الزيادة في عدد الشعب خاصة بهذا الطلب، وليست لاستكمال أنصبة فهد ومحمد.');
 validateRequest(input);return input;
}

/** Call only after explicit authorization of these scenario-only afternoon periods. */
export function withApprovedAfternoonPeriods(source:PlanRequest,includeNecessary18Period=false):PlanRequest {
 const input=structuredClone(source),fixed=input.policy.lecturePeriods;
 if(!input.stableBlockPlan||!fixed||fixed.academicHourMinutes!==50)throw Error('Stable 50-minute period policy required');
 for(const startMinute of [14*60,16*60,...(includeNecessary18Period?[18*60]:[])])if(!fixed.regular.some(p=>p.startMinute===startMinute))
  fixed.regular.push({startMinute,endMinute:startMinute+100,trainingHours:2});
 input.policy.slots=input.policy.slots.map(w=>({...w,to:Math.max(w.to,includeNecessary18Period?20:18)}));
 input.projection?.assumptions.push('موافقة المستخدم لهذه المسودة فقط: فترتا 14:00–15:40 و16:00–17:40 من الأحد إلى الأربعاء؛ لا تغيير للعامة أو حد يومي الحضور أو السياسة المشتركة.');
 if(includeNecessary18Period)input.projection?.assumptions.push('بتوجيه المستخدم بإضافة الفترات اللازمة مع ثبات العامة: أضيفت 18:00–19:40 لأن المستوى الثالث يحتاج 11 بداية لقاء مع الإنجليزية، مقابل 10 فقط في يومين بخمس فترات. لم تُقسم شعب أو ساعات منهج.');
 validateRequest(input);return input;
}

/** Exact whole-section load packing is an arithmetic bound, not a timetable solution. */
export function reassignmentCapacity(input:PlanRequest){
 const available=input.courses.filter(c=>internal(c)&&input.instructors.some(i=>['5','6'].includes(i.id)&&trainerQualified(i,c)));
 const hours=available.reduce((n,c)=>n+sectionHours(c),0);
 type Bundle={fahad:string[];mohammed:string[]};
 let states=new Map<string,Bundle>([['0/0',{fahad:[],mohammed:[]}]]);
 for(const c of available)for(let i=0;i<(c.blockSizes?.length??0);i++){
  const id=`${c.code}-${String(i+1).padStart(3,'0')}`,weight=c.theoryHours+c.practicalHours;
  const next=new Map(states);
  for(const [key,ids] of states){const [a,b]=key.split('/').map(Number) as [number,number];
   if(a+weight<=24&&trainerQualified(input.instructors.find(i=>i.id==='5')!,c)&&!next.has(`${a+weight}/${b}`))next.set(`${a+weight}/${b}`,{fahad:[...ids.fahad,id],mohammed:ids.mohammed});
   if(b+weight<=24&&trainerQualified(input.instructors.find(i=>i.id==='6')!,c)&&!next.has(`${a}/${b+weight}`))next.set(`${a}/${b+weight}`,{fahad:ids.fahad,mohammed:[...ids.mohammed,id]});
  }
  states=next;
 }
 const split=[...states.keys()].map(key=>({key,loads:key.split('/').map(Number) as [number,number]})).sort((a,b)=>
  b.loads[0]+b.loads[1]-a.loads[0]-a.loads[1]||Math.abs(a.loads[0]-a.loads[1])-Math.abs(b.loads[0]-b.loads[1])||b.loads[0]-a.loads[0])[0]!;
 const practical=input.courses.filter(c=>internal(c)&&courseType(c)==='PRACTICAL');
 const practicalHours=practical.reduce((n,c)=>n+sectionHours(c),0);
 const abdullahReserved=input.courses.filter(c=>abdullahCodes.includes(c.code)).reduce((n,c)=>n+sectionHours(c),0);
 const abdullah=input.instructors.find(i=>i.id==='4')!;
 const abdullahPracticalHours=Math.max(0,Math.floor((abdullah.maxLoad-abdullahReserved)/4)*4);
 const otherPracticalCapacity=input.instructors.filter(i=>i.id!=='4'&&practical.some(c=>trainerQualified(i,c))).reduce((n,i)=>n+Math.floor(i.maxLoad/4)*4,0);
 return {availableCourseCodes:available.map(c=>c.code),availableHours:hours,requestedHours:48,
  shortfallHours:48-split.loads[0]-split.loads[1],balancedWholeSectionLoads:split.loads,
  suggestedFahadSections:states.get(split.key)!.fahad,suggestedMohammedSections:states.get(split.key)!.mohammed,
  abdullahReservedHours:abdullahReserved,abdullahLimit:abdullah.maxLoad,
  practicalHours,maximumPracticalHoursWithinCurrentLimits:otherPracticalCapacity+abdullahPracticalHours,
  practicalShortfallHours:Math.max(0,practicalHours-otherPracticalCapacity-abdullahPracticalHours),
  scope:'ARITHMETIC_ONLY_NOT_SCHEDULING_FEASIBILITY' as const};
}

/** Latest explicit ownership request, applied only to an independent scenario snapshot. */
export function applyDepartmentReassignment(source:PlanRequest,economics:EconomicsAssignment,allowPractical=false):PlanRequest {
 validateRequest(source);
 if(!source.stableBlockPlan)throw Error('Stable-block source required');
 if(!['KEEP_WITH_ANS','MOVE_TO_FAHAD_MOHAMMED'].includes(economics))throw Error('Explicit Economics decision required');
 const input=structuredClone(source);
 for(const id of ['1','2','3','4','5','6'])if(!input.instructors.some(i=>i.id===id))throw Error('Missing department trainer '+id);
 for(const code of abdullahCodes){
  const c=input.courses.find(c=>c.code===code&&internal(c));if(!c)throw Error('Missing explicitly assigned course '+code);
  c.assignedInstructorId='4';c.exclusiveInstructor=true;
 }
 const practicalCodes=input.courses.filter(c=>internal(c)&&courseType(c)==='PRACTICAL').map(c=>c.code);
 const theoreticalCodes=input.courses.filter(c=>internal(c)&&courseType(c)!=='PRACTICAL'&&!abdullahCodes.includes(c.code)&&
  (economics==='MOVE_TO_FAHAD_MOHAMMED'||c.code!=='اقصد-101')).map(c=>c.code);
 for(const c of input.courses.filter(c=>theoreticalCodes.includes(c.code)))delete c.assignedInstructorId;
 for(const i of input.instructors){
  if(i.id==='4'){
   i.teachingRules={...i.teachingRules,allowedCourseTypes:['THEORY','PRACTICAL','MIXED']};
   // The request authorizes this mixed course; it does not open every mixed course to trainer 4.
   i.eligibleCourseCodes=[...abdullahCodes,...practicalCodes];
  }else if(i.id==='1'||i.id==='3'&&!allowPractical){
   i.eligibleCourseCodes=practicalCodes.filter(code=>!i.eligibleCourseCodes||i.eligibleCourseCodes.includes(code));
  }else if(['5','6'].includes(i.id)){
   i.eligibleCourseCodes=[...theoreticalCodes,...(allowPractical?practicalCodes:[])];
   i.teachingRules={...i.teachingRules,allowedCourseTypes:['THEORY','MIXED',...(allowPractical?['PRACTICAL' as const]:[])],preferredCreditedLoad:24};
  }else if(i.id==='2')i.eligibleCourseCodes=economics==='KEEP_WITH_ANS'?['اقصد-101']:[];
 }
 const eco=input.courses.find(c=>c.code==='اقصد-101');if(eco){
  if(economics==='KEEP_WITH_ANS')eco.assignedInstructorId='2';else delete eco.assignedInstructorId;
 }
 if(input.scheduleRefinement){
  input.scheduleRefinement.keepInstructors=false;
  for(const s of input.scheduleRefinement.referenceSessions)if(abdullahCodes.includes(s.courseCode))s.instructorId='4';
  for(const [id] of Object.entries(input.scheduleRefinement.referenceInstructors)){
   if(abdullahCodes.some(c=>id.startsWith(c+'-')))input.scheduleRefinement.referenceInstructors[id]='4';
   else if(theoreticalCodes.some(c=>id.startsWith(c+'-')))delete input.scheduleRefinement.referenceInstructors[id];
  }
 }
 input.projection?.assumptions.push('بتوجيه المستخدم: مبادئ الإدارة وريادة الأعمال في مجال الإدارة لعبدالله؛ بقية النظري والمختلط لفهد ومحمد؛ مستهدف كل منهما 24 دون تقسيم إضافي أو ساعات مخترعة.');
 if(allowPractical)input.projection?.assumptions.push('توجيه المستخدم الأحدث يسمح باستكمال نصابي فهد ومحمد من العملي أيضًا؛ أولوية النظري والمختلط مع حفظ الساعات والأنصبة وعضويات البلوكات. قد يلزم إسناد بعض النظري لعيسى لتحقيق توزيع الساعات الصحيحة دون تقسيم الشعب.');
 validateRequest(input);return input;
}

export function reassignmentIssues(input:PlanRequest,result:PlanResult){
 const capacity=reassignmentCapacity(input);
 return {capacity,
  remainingUncovered:result.gaps.map(g=>({sectionId:g.sectionId,courseCode:g.courseCode,contactHours:g.contactHours})),
  requestedOwnershipSatisfied:result.sections.every(s=>s.state==='UNASSIGNED'||
   (abdullahCodes.includes(s.courseCode)?s.instructorId==='4':courseType(input.courses.find(c=>c.code===s.courseCode)!)==='PRACTICAL'||s.courseCode==='اقصد-101'&&input.courses.find(c=>c.code===s.courseCode)?.assignedInstructorId==='2'||['5','6'].includes(s.instructorId??''))),
  actualLoads:Object.fromEntries(result.instructorLoads.filter(l=>['4','5','6'].includes(l.id)).map(l=>[l.id,l.credited]))};
}

/** Whole-section ownership witness; Timefold must still place every meeting and verify campus/resource rules. */
export function planWholeSectionOwnership(input:PlanRequest,sections:PlanResult['sections']):Record<string,string> {
 const trainers=new Map(input.instructors.map(i=>[i.id,i])),courses=new Map(input.courses.map(c=>[c.code,c]));
 const assignment:Record<string,string>={},loads:Record<string,number>=Object.fromEntries(input.instructors.map(i=>[i.id,0]));
 const reserve=(s:PlanResult['sections'][number],id:string)=>{assignment[s.id]=id;loads[id]!+=s.creditedLoad;};
 for(const s of sections){const c=courses.get(s.courseCode)!;if(c.assignedInstructorId)reserve(s,c.assignedInstructorId);}
 const khalid=sections.filter(s=>!assignment[s.id]&&s.instructorId==='1'&&courseType(courses.get(s.courseCode)!)==='PRACTICAL');
 const alternatives=sections.filter(s=>!assignment[s.id]&&courseType(courses.get(s.courseCode)!)==='PRACTICAL');
 const khalidSections=[...khalid,...alternatives.filter(s=>!khalid.some(k=>k.id===s.id))].slice(0,2);
 for(const s of khalidSections)reserve(s,'1');
 const priority=(s:PlanResult['sections'][number])=>courseType(courses.get(s.courseCode)!)==='MIXED'?0:s.courseCode==='ادار-222'?1:s.courseCode==='ادار-253'?2:courseType(courses.get(s.courseCode)!)==='THEORY'?3:4;
 const jobs=sections.filter(s=>!assignment[s.id]).sort((a,b)=>priority(a)-priority(b)||b.creditedLoad-a.creditedLoad||a.id.localeCompare(b.id));
 const memo=new Set<string>();
 function visit(index:number):boolean {
  if(index===jobs.length)return Math.abs(loads['5']!-24)<1e-8&&Math.abs(loads['6']!-24)<1e-8;
  const key=index+'/'+['3','4','5','6'].map(id=>loads[id]).join('/');if(memo.has(key))return false;
  const remaining=jobs.slice(index).reduce((n,s)=>n+s.creditedLoad,0);if(48-loads['5']!-loads['6']!>remaining+1e-8)return false;
  const s=jobs[index]!,c=courses.get(s.courseCode)!;
  const desired=['5','6'].sort((a,b)=>loads[a]!-loads[b]!);
  for(const id of [...desired,'3','4']){
   const i=trainers.get(id)!;if(!trainerQualified(i,c)||loads[id]!+s.creditedLoad>i.maxLoad+(i.overload?.additionalHours??0)+1e-8)continue;
   reserve(s,id);if(visit(index+1))return true;loads[id]!-=s.creditedLoad;delete assignment[s.id];
  }
  memo.add(key);return false;
 }
 if(!visit(0))throw Error('No whole-section ownership satisfies 24/24 and existing instructor limits');
 return assignment;
}
