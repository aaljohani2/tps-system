import {createHash} from 'node:crypto';
import type {Day,PlanRequest,PlanResult,Session} from './types.js';
import type {GeneralSourceItem,GeneralLock} from './general-courses.js';

/** Source occurrences are evidence, never permission to manufacture external sections. */
export interface FixedGeneralSource extends GeneralSourceItem {
 courseCode:string|null;physicalColored:boolean;plannedMode:'ONSITE'|'REMOTE';deliveryMarker:string;
 capacity?:number|null;sectionIdentity?:string|null;
}
export interface StableBlockPlan {
 version:1;baselineScenarioId:string;sourceSha256:string;sourceRowsSha256:string;
 sourceRows:FixedGeneralSource[];
 bindings:Array<{sourceItemId:string;blockIds:string[];basis:'PLANNING_SOURCE_GROUP';blockStudents?:Record<string,number>}>;
 maxCampusDays:2;remoteSectionCapacity:100;additionalLoadSplits:false;
 departmentSectionCounts:Record<string,number>;
 /** Explicit population-alignment request; never a split performed merely to fill instructor load. */
 principlesEconomicsAlignment?:{reason:'USER_REQUEST_MATCH_ECONOMICS';previousPrinciplesSectionCount:number;referenceSectionCount:number};
 smallBlockClosure?:{reason:'USER_APPROVED_SMALL_BLOCK_CLOSURE';previousBlocks:NonNullable<PlanRequest['cohortBlocks']>;
  previousBindings:StableBlockPlan['bindings'];previousDepartmentSectionCounts:Record<string,number>;
  transfers:Array<{closedBlockId:string;recipients:Array<{blockId:string;students:number}>}>};
}
/** Preserve source seats. A partial inherited group reserves time conservatively for its new teaching block. */
export function closureGeneralBindings(closure:NonNullable<StableBlockPlan['smallBlockClosure']>):StableBlockPlan['bindings']{
 return closure.previousBindings.map(binding=>{
  const blockStudents:Record<string,number>={};
  for(const ref of binding.blockIds){
   const transfer=closure.transfers.find(t=>t.closedBlockId===ref);
   if(transfer)for(const target of transfer.recipients)blockStudents[target.blockId]=(blockStudents[target.blockId]??0)+target.students;
   else blockStudents[ref]=(blockStudents[ref]??0)+closure.previousBlocks.find(b=>b.ref===ref)!.size;
  }
  return {...binding,blockIds:Object.keys(blockStudents),blockStudents};
 });
}
// PostgreSQL JSONB reorders object keys; provenance must survive persistence and reload.
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>[k,canonical(v)]));
 return value;
}
export const sourceRowsHash=(rows:FixedGeneralSource[])=>createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex');
const days:Day[]=['SUN','MON','TUE','WED','THU'];
const members=(s:{blockId:string|null;blockIds?:string[]})=>s.blockIds??(s.blockId?[s.blockId]:[]);

/** Preserve section counts; choose only unions of entire blocks, as close to old sizes as possible. */
function regroup(blocks:NonNullable<PlanRequest['cohortBlocks']>,count:number,capacity:number,oldSizes:number[]):string[][] {
 if(count<1||count>blocks.length)throw Error('Existing section count cannot represent whole stable blocks');
 let best:string[][]|undefined,cost=Infinity;
 const groups:string[][]=Array.from({length:count},()=>[]),sizes=Array(count).fill(0) as number[];
 function visit(index:number){
  if(index===blocks.length){if(sizes.some(n=>!n))return;
   const next=sizes.reduce((n,size,i)=>n+(size-(oldSizes[i]??0))**2,0);
   if(next<cost){cost=next;best=groups.map(g=>[...g]);}return;}
  const block=blocks[index]!;
  for(let i=0;i<count;i++){
   if(sizes[i]!+block.size>capacity)continue;
   const empty=sizes[i]===0;groups[i]!.push(block.ref);sizes[i]!+=block.size;visit(index+1);sizes[i]!-=block.size;groups[i]!.pop();
   if(empty)break;
  }
 }
 visit(0);if(!best)throw Error('Existing sections cannot hold whole stable blocks within capacity');return best;
}

export function createStableBlockPlan(source:PlanRequest,baselineScenarioId:string,rows:FixedGeneralSource[],sourceSha256:string):PlanRequest {
 const input=structuredClone(source),counts=input.projection?.levelStudents;
 if(!counts)throw Error('Actual level populations are required');
 delete input.generalCourseSchedule;delete input.scheduleRefinement;
 input.scenarioName='SCENARIO-05-STABLE-BLOCKS-20261109 — مسودة بلوكات ثابتة';
 input.cohortBlocks=[];
 for(const level of [1,2,3,4]){
  const total=counts[level];if(!Number.isInteger(total)||total!<0||total!>7500)throw Error('Invalid level population');
  for(let at=0,n=1;at<total!;at+=40,n++)input.cohortBlocks.push({ref:`STABLE-L${level}::B${String(n).padStart(2,'0')}`,level,size:Math.min(40,total!-at)});
 }
 for(const c of input.courses){
  const blocks=input.cohortBlocks.filter(b=>b.level===c.level);c.demand=blocks.reduce((n,b)=>n+b.size,0);
  if(!c.demand){delete c.blocks;delete c.blockSizes;delete c.blockGroups;continue;}
  const capacity=c.assignmentScope==='EXTERNAL'?40:c.sectionCapacity??(c.practicalHours&&!c.theoryHours?40:120);
  const targets=c.blockSizes??[];
  c.blockGroups=c.assignmentScope==='EXTERNAL'?blocks.map(b=>[b.ref]):regroup(blocks,c.blockSizes?.length??Math.ceil(c.demand/capacity),capacity,targets);
  c.blocks=c.blockGroups.map(g=>g.join(' + '));c.blockSizes=c.blockGroups.map(g=>blocks.filter(b=>g.includes(b.ref)).reduce((n,b)=>n+b.size,0));
  if(c.code==='ادار-101'){c.assignedInstructorId='4';c.exclusiveInstructor=true;}
 }
 input.policy.slots=input.policy.slots.filter(w=>w.day!=='THU');
 for(const override of Object.values(input.policy.lecturePeriods?.courseOverrides??{}))override.allowCohortOverlap=false;
 const economics=input.policy.lecturePeriods?.courseOverrides['اقصد-101'];
 if(economics&&!economics.periods.some(p=>p.startMinute===480))economics.periods.unshift({startMinute:480,endMinute:630,trainingHours:3});
 input.policy.capacities.REMOTE={theory:100,practical:100};
 const sourceRows=structuredClone(rows);
 const bindings=sourceRows.flatMap(row=>{
  // This is the documented provisional group mapping, not an assertion of official rosters.
  const block=input.cohortBlocks!.filter(b=>b.level===row.level)[row.sourceGroupNumber-1];
  return block&&row.courseCode?[{sourceItemId:row.id,blockIds:[block.ref],basis:'PLANNING_SOURCE_GROUP' as const}]:[];
 });
 input.stableBlockPlan={version:1,baselineScenarioId,sourceSha256,sourceRowsSha256:sourceRowsHash(sourceRows),sourceRows,bindings,
  maxCampusDays:2,remoteSectionCapacity:100,additionalLoadSplits:false,
  departmentSectionCounts:Object.fromEntries(source.courses.filter(c=>c.assignmentScope!=='EXTERNAL'&&c.demand>0).map(c=>[c.code,c.blockSizes?.length??Math.ceil(c.demand/(c.sectionCapacity??120))]))};
 input.projection!.key='STABLE_BLOCKS';
 for(const level of [1,2,3,4])input.projection!.baseBlocksByLevel[level]=input.cohortBlocks.filter(b=>b.level===level).length;
 input.projection!.assumptions.push('عضويات بلوكات تخطيطية ثابتة؛ العامة محفوظة من المصدر؛ لا تقسيم إضافي لاستكمال الأنصبة. الشعبة عن بُعد سقفها 100، ولا تفتح شعبة عامة جديدة.');
 return input;
}

/** Complete known intervals only; missing ends and self-paced markers never acquire guessed duration. */
export function stableGeneralLocks(input:PlanRequest):GeneralLock[]{
 const stable=input.stableBlockPlan;if(!stable)return [];
 return stable.sourceRows.flatMap(row=>{
  const binding=stable.bindings.find(b=>b.sourceItemId===row.id),start=row.startMinute,end=row.endMinute;
  if(!binding?.blockIds.length||!row.courseCode||row.kind==='SELF_PACED'||row.kind==='CANCELLED'||!row.day||
   start===null||end===null||end<=start||(end-start)%(input.policy.lecturePeriods?.academicHourMinutes??60)!==0)return [];
  const students=binding.blockStudents?Object.values(binding.blockStudents).reduce((n,b)=>n+b,0):input.cohortBlocks!.filter(b=>binding.blockIds.includes(b.ref)).reduce((n,b)=>n+b.size,0);
  return [{id:`FIXED:${row.id}`,sourceItemId:row.id,externalSectionId:`SOURCE:${row.id}`,courseCode:row.courseCode,level:row.level,
   students,blockIds:binding.blockIds,day:row.day,startMinute:start,endMinute:end,
   trainingHours:(end-start)/(input.policy.lecturePeriods?.academicHourMinutes??60),mode:row.plannedMode,instructorId:null,roomId:null,
   responsibleLabel:'قسم الدراسات العامة - إسناد افتراضي',status:'PROVISIONAL_LOCKED' as const,sourceCells:row.sourceCells,
   mappingBasis:'USER_CONFIRMED_PLANNING_ASSUMPTION' as const}];
 });
}

export function campusDays(input:PlanRequest,sessions:Session[]){
 const fixed=stableGeneralLocks(input);
 return (input.cohortBlocks??[]).map(block=>{
  const internal=sessions.filter(s=>members(s).includes(block.ref)),external=fixed.filter(l=>l.blockIds.includes(block.ref));
  const onsite=days.filter(day=>internal.some(s=>s.day===day&&s.mode==='ONSITE')||external.some(s=>s.day===day&&s.mode==='ONSITE'));
  const remote=days.filter(day=>internal.some(s=>s.day===day&&s.mode==='REMOTE')||external.some(s=>s.day===day&&s.mode==='REMOTE'));
  return {blockId:block.ref,level:block.level,students:block.size,campusDays:onsite,remoteDays:remote,campusDayCount:onsite.length};
 });
}
export function violatesStableRules(input:PlanRequest,sessions:Session[]):boolean {
 return !!input.stableBlockPlan&&(sessions.some(s=>s.day==='THU')||campusDays(input,sessions).some(b=>b.campusDayCount>2));
}
export function validateStableBlocks(input:PlanRequest):void {
 const stable=input.stableBlockPlan;if(!stable)return;
 if(stable.version!==1||stable.maxCampusDays!==2||stable.remoteSectionCapacity!==100||stable.additionalLoadSplits!==false||
  !stable.baselineScenarioId||!/^[a-f0-9]{64}$/.test(stable.sourceSha256)||!Array.isArray(stable.sourceRows)||stable.sourceRows.length>2000||
  sourceRowsHash(stable.sourceRows)!==stable.sourceRowsSha256||new Set(stable.sourceRows.map(r=>r.id)).size!==stable.sourceRows.length)
  throw Error('Invalid or modified stable-block source inventory');
 if(input.policy.slots.some(w=>w.day==='THU')||Object.values(input.policy.lecturePeriods?.courseOverrides??{}).some(p=>p.allowCohortOverlap))throw Error('Stable department rules prohibit Thursday and cohort overlap');
 if(!stable.departmentSectionCounts||!input.projection?.levelStudents)throw Error('Stable section counts and populations required');
 const closure=stable.smallBlockClosure;
 let expectedBlocks:PlanRequest['cohortBlocks'];
 if(closure){
  const expectedTransfers=[{closedBlockId:'STABLE-L2::B05',recipients:[1,2,3,4].map(n=>({blockId:`STABLE-L2::B0${n}`,students:3}))},
   {closedBlockId:'STABLE-L4::B03',recipients:[{blockId:'STABLE-L4::B01',students:9},{blockId:'STABLE-L4::B02',students:8}]}];
  if(closure.reason!=='USER_APPROVED_SMALL_BLOCK_CLOSURE'||!Array.isArray(closure.previousBlocks)||!Array.isArray(closure.previousBindings)||
   JSON.stringify(canonical(closure.transfers))!==JSON.stringify(canonical(expectedTransfers))||input.projection.levelStudents[2]!==172||input.projection.levelStudents[4]!==97)
   throw Error('Invalid approved small-block closure');
  const old=closure.previousBlocks;
  for(const level of [1,2,3,4]){
   const count=input.projection.levelStudents[level]!,blocks=old.filter(b=>b.level===level);
   if(blocks.length!==Math.ceil(count/40)||blocks.some((b,index)=>b.ref!==`STABLE-L${level}::B${String(index+1).padStart(2,'0')}`||b.size!==Math.min(40,count-index*40)))throw Error('Invalid pre-closure membership');
  }
  expectedBlocks=old.filter(b=>!closure.transfers.some(t=>t.closedBlockId===b.ref)).map(b=>({...b,size:b.size+closure.transfers.reduce((n,t)=>n+(t.recipients.find(r=>r.blockId===b.ref)?.students??0),0)}));
  if(JSON.stringify(canonical(stable.bindings))!==JSON.stringify(canonical(closureGeneralBindings(closure))))throw Error('Inherited general seats or memberships changed');
  const expectedCounts={...closure.previousDepartmentSectionCounts,'ادار-151':4,'ادار-253':2};
  if(closure.previousDepartmentSectionCounts['ادار-151']!==5||closure.previousDepartmentSectionCounts['ادار-253']!==3||
   JSON.stringify(canonical(stable.departmentSectionCounts))!==JSON.stringify(canonical(expectedCounts)))throw Error('Unexpected department closures');
  for(const [code,capacity] of Object.entries({'ادار-151':43,'ادار-253':49}))if(input.courses.find(c=>c.code===code)?.sectionCapacity!==capacity||input.policy.courseSectionCapacities?.[code]!==capacity)throw Error('Approved practical capacities required');
 }
 for(const level of [1,2,3,4]){
  const count=input.projection.levelStudents[level]!,blocks=input.cohortBlocks?.filter(b=>b.level===level)??[];
  const expected=expectedBlocks?.filter(b=>b.level===level);
  if(expected?blocks.length!==expected.length||blocks.some((b,index)=>b.ref!==expected[index]!.ref||b.size!==expected[index]!.size):
   blocks.length!==Math.ceil(count/40)||blocks.some((b,index)=>b.ref!==`STABLE-L${level}::B${String(index+1).padStart(2,'0')}`||b.size!==Math.min(40,count-index*40)))throw Error('Stable membership or actual population changed');
 }
 for(const [code,count] of Object.entries(stable.departmentSectionCounts))if(input.courses.find(c=>c.code===code)?.blockGroups?.length!==count)throw Error('Additional department section splits prohibited');
 if(stable.principlesEconomicsAlignment){
  const alignment=stable.principlesEconomicsAlignment,principles=input.courses.find(c=>c.code==='ادار-101'),economics=input.courses.find(c=>c.code==='اقصد-101');
  if(alignment.reason!=='USER_REQUEST_MATCH_ECONOMICS'||!Number.isInteger(alignment.previousPrinciplesSectionCount)||alignment.previousPrinciplesSectionCount<1||
   !principles||!economics||principles.level!==economics.level||principles.demand!==economics.demand||
   alignment.referenceSectionCount!==economics.blockGroups?.length||stable.departmentSectionCounts['ادار-101']!==alignment.referenceSectionCount||
   JSON.stringify(principles.blockSizes)!==JSON.stringify(economics.blockSizes)||JSON.stringify(principles.blockGroups)!==JSON.stringify(economics.blockGroups))
   throw Error('Principles sections must match Economics populations and whole-block memberships');
 }
 if(input.courses.some(c=>c.assignmentScope!=='EXTERNAL'&&c.mode==='REMOTE'&&(c.sectionCapacity??Infinity)>100))throw Error('Remote section capacity exceeds 100');
 for(const binding of stable.bindings){
  const row=stable.sourceRows.find(r=>r.id===binding.sourceItemId);
  const blocks=input.cohortBlocks?.filter(b=>binding.blockIds.includes(b.ref))??[];
  const partial=binding.blockStudents;
  if(partial&&(!closure||Object.keys(partial).length!==binding.blockIds.length||blocks.some(b=>!Number.isInteger(partial[b.ref])||partial[b.ref]!<1||partial[b.ref]!>b.size)))throw Error('Invalid inherited general student counts');
  if(!row||!blocks.length||blocks.length!==new Set(binding.blockIds).size||blocks.length!==binding.blockIds.length||blocks.some(b=>b.level!==row.level)||
   blocks.reduce((n,b)=>n+(partial?.[b.ref]??b.size),0)>Math.min(row.capacity??Infinity,row.plannedMode==='REMOTE'?100:40))throw Error('Invalid general source binding or capacity');
 }
 if(new Set(stable.bindings.map(b=>b.sourceItemId)).size!==stable.bindings.length)throw Error('Duplicated general source binding');
 for(const row of stable.sourceRows)if(row.plannedMode!==(row.physicalColored?'ONSITE':'REMOTE'))throw Error('General source fill/mode mismatch');
 if(input.courses.find(c=>c.code==='ادار-101')?.assignedInstructorId!=='4')throw Error('Principles must stay with instructor 4');
}

export function stableBlockDiagnostics(input:PlanRequest,result?:PlanResult){
 const stable=input.stableBlockPlan;if(!stable)return [];
 const issues:Array<{code:string;message:string;blockId?:string;courseCode?:string}>=[];
 if(stable.smallBlockClosure)issues.push({code:'GENERAL_REDISTRIBUTION_PENDING',message:'أغلقت بلوكات القسم الصغيرة فقط؛ شعب العامة وسعاتها ومواعيدها ثابتة. حُفظت المقاعد الموروثة دون زيادتها؛ 12 متدربًا في الثاني و17 في الرابع يحتاجون توزيع عضويات عامة منفصلًا ومثبتًا. حجز وقت العامة للمقاعد الموروثة تحفظي، وليس إثبات تغطية البلوك الجديد بالكامل.'});
 const unit=input.policy.lecturePeriods?.academicHourMinutes??60;
 const dailyMinutes=(input.policy.lecturePeriods?.regular??[]).reduce((n,p)=>n+p.endMinute-p.startMinute,0);
 const fixed=input.policy.lecturePeriods;
 if(fixed?.partialPeriod==='TRIM_END')for(const block of input.cohortBlocks??[]){
  if(input.courses.some(c=>c.level===block.level&&fixed.courseOverrides[c.code]))continue;
  const chunk=Math.max(...fixed.regular.map(p=>p.trainingHours));
  const department=input.courses.filter(c=>c.level===block.level&&c.assignmentScope!=='EXTERNAL'&&c.mode==='ONSITE')
   .reduce((n,c)=>n+Math.ceil(c.theoryHours/chunk)+Math.ceil(c.practicalHours/chunk),0);
  const general=stableGeneralLocks(input).filter(l=>l.mode==='ONSITE'&&l.blockIds.includes(block.ref)&&fixed.regular.some(p=>p.startMinute===l.startMinute&&p.endMinute===l.endMinute)).length;
  if(department+general>2*fixed.regular.length)issues.push({code:'TWO_DAY_PERIOD_STARTS_INFEASIBLE',blockId:block.ref,
   message:`${block.ref}: يلزم ${department+general} بداية لقاء حضوري، والمتاح ${2*fixed.regular.length} في يومين؛ الفترات القصيرة تترك نصف فترة غير مستخدم.`});
 }
 for(const level of [1,2,3,4]){
  const hours=input.courses.filter(c=>c.level===level&&c.assignmentScope!=='EXTERNAL').reduce((n,c)=>n+(c.mode==='ONSITE'?c.theoryHours+c.practicalHours:c.mode==='HYBRID'?(c.hybridSplit!.theoryOnsiteHours+c.hybridSplit!.practicalOnsiteHours):0),0);
  if(hours*unit>2*dailyMinutes)issues.push({code:'TWO_DAY_CAPACITY_INFEASIBLE',message:`المستوى ${level}: ${hours} ساعة حضورية تخصصية تتجاوز سعة الفترات العادية في يومين (${2*dailyMinutes/unit})، قبل العامة.`});
 }
 for(const c of input.courses.filter(c=>c.assignmentScope==='EXTERNAL')){
  const rows=stable.sourceRows.filter(r=>r.courseCode===c.code);
  if(!rows.length)issues.push({code:'GENERAL_SOURCE_MISSING',courseCode:c.code,message:`${c.title}: غير وارد في المصدر، والاحتياج محفوظ.`});
  const colored=rows.filter(r=>r.physicalColored),capacity=colored.reduce((n,r)=>n+(r.capacity??40),0);
  if(colored.length&&capacity<c.demand)issues.push({code:'GENERAL_ONSITE_CAPACITY_SHORTFALL',courseCode:c.code,message:`${c.title}: تغطية حضورية ${capacity}/${c.demand} تحت سقف 40؛ لم تضف شعب.`});
 }
 if(stable.sourceRows.some(r=>r.plannedMode==='REMOTE'))issues.push({code:'GENERAL_IDENTITY_AND_REMOTE_COVERAGE_PENDING',message:'هوية الشعب المشتركة وعلاقة المواعيد والسعات غير مثبتة؛ لم تدمج ظهورات متزامنة ولم تنشأ بدائل أو شعب عامة. سقف عن بُعد 100.'});
 if(stableGeneralLocks(input).length<stable.sourceRows.filter(r=>r.kind!=='SELF_PACED').length)issues.push({code:'GENERAL_TIME_PENDING',message:'بعض البدايات أو النهايات أو العضويات غير مكتملة؛ لا نهايات مخمنة ولا حجوزات ذاتية متزامنة.'});
 issues.push({code:'GENERAL_RESOURCES_PENDING',message:'مدربو العامة الحقيقيون والقاعات الحضورية غير معلومة؛ الجهة الافتراضية ليست مدربًا واحدًا.'});
 if(result){
  for(const row of campusDays(input,result.sessions))if(row.campusDayCount>2)issues.push({code:'CAMPUS_DAY_CAP_EXCEEDED',blockId:row.blockId,message:`${row.blockId}: ${row.campusDayCount} أيام حضور فعلي.`});
  for(const session of result.sessions)if(session.day==='THU')issues.push({code:'DEPARTMENT_THURSDAY',message:'لقاء تخصصي يوم الخميس.'});
  for(const i of input.instructors.filter(i=>(i.teachingRules?.preferredCreditedLoad??0)>0)){
   const actual=result.instructorLoads.find(l=>l.id===i.id)?.credited??0,target=i.teachingRules!.preferredCreditedLoad!;
   if(actual<target)issues.push({code:'LOAD_TARGET_UNMET',message:`${i.name}: ${actual}/${target}؛ لم تقسّم شعب لاستكمال النصاب.`});
  }
 }
 return issues;
}
