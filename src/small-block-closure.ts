import type {PlanRequest,PlanResult} from './types.js';
import {validateRequest} from './validation.js';
import {closureGeneralBindings} from './stable-blocks.js';

/** Explicitly authorized, scenario-only closure; source General Studies sections remain intact. */
export function closeSmallStableBlocks(source:PlanRequest,baseline:PlanResult):PlanRequest {
 validateRequest(source);
 if(!source.stableBlockPlan||source.stableBlockPlan.smallBlockClosure||!source.cohortBlocks||!source.scheduleRefinement||baseline.gaps.length)
  throw Error('Complete original stable-block snapshot required');
 const input=structuredClone(source),stable=input.stableBlockPlan!,previousBlocks=structuredClone(source.cohortBlocks);
 if(previousBlocks.find(b=>b.ref==='STABLE-L2::B05')?.size!==12||previousBlocks.find(b=>b.ref==='STABLE-L4::B03')?.size!==17)
  throw Error('Expected small-block populations 12 and 17');
 stable.smallBlockClosure={reason:'USER_APPROVED_SMALL_BLOCK_CLOSURE',previousBlocks,previousBindings:structuredClone(stable.bindings),
  previousDepartmentSectionCounts:{...stable.departmentSectionCounts},transfers:[
   {closedBlockId:'STABLE-L2::B05',recipients:[1,2,3,4].map(n=>({blockId:`STABLE-L2::B0${n}`,students:3}))},
   {closedBlockId:'STABLE-L4::B03',recipients:[{blockId:'STABLE-L4::B01',students:9},{blockId:'STABLE-L4::B02',students:8}]}]};
 const transfers=stable.smallBlockClosure.transfers;
 input.cohortBlocks=previousBlocks.filter(b=>!transfers.some(t=>t.closedBlockId===b.ref)).map(b=>({...b,size:b.size+transfers.reduce((n,t)=>n+(t.recipients.find(r=>r.blockId===b.ref)?.students??0),0)}));
 stable.bindings=closureGeneralBindings(stable.smallBlockClosure);
 for(const c of input.courses.filter(c=>c.assignmentScope!=='EXTERNAL'&&[2,4].includes(c.level))){
  const blocks=input.cohortBlocks.filter(b=>b.level===c.level);
  c.blockGroups=c.code==='ادار-111'?[[blocks[0]!.ref,blocks[1]!.ref],[blocks[2]!.ref,blocks[3]!.ref]]:
   c.code==='ادار-231'?[blocks.map(b=>b.ref)]:blocks.map(b=>[b.ref]);
  c.blocks=c.blockGroups.map(g=>g.join(' + '));c.blockSizes=c.blockGroups.map(g=>blocks.filter(b=>g.includes(b.ref)).reduce((n,b)=>n+b.size,0));
 }
 for(const [code,capacity] of Object.entries({'ادار-151':43,'ادار-253':49})){
  const c=input.courses.find(c=>c.code===code);if(!c)throw Error('Missing practical course '+code);
  c.sectionCapacity=capacity;input.policy.courseSectionCapacities={...input.policy.courseSectionCapacities,[code]:capacity};
  stable.departmentSectionCounts[code]=c.blockSizes!.length;
 }
 const removed=['ادار-151-005','ادار-253-003'];
 const remaining=baseline.sections.filter(s=>!removed.includes(s.id));
 if(baseline.sections.filter(s=>removed.includes(s.id)).length!==2)throw Error('Expected complete closing sections');
 const refinement=input.scheduleRefinement!;
 refinement.keepInstructors=true;refinement.referenceInstructors=Object.fromEntries(remaining.map(s=>[s.id,s.instructorId!]));
 refinement.requiredCreditedLoads=Object.fromEntries(input.instructors.map(i=>[i.id,remaining.filter(s=>s.instructorId===i.id).reduce((n,s)=>n+s.creditedLoad,0)]));
 refinement.requiredCourseCodes=input.courses.filter(c=>c.assignmentScope!=='EXTERNAL'&&c.demand>0).map(c=>c.code);
 const update=baseline.sessions.filter(s=>!removed.includes(s.sectionId)).map(s=>{
  const c=input.courses.find(c=>c.code===s.courseCode)!,index=Number(s.sectionId.slice(-3))-1;
  return {...s,blockId:c.blocks![index]!,blockIds:c.blockGroups![index]!};
 });
 refinement.referenceSessions=structuredClone(update);refinement.initialSessions=update;
 // The latest request accepts the reduced workload; do not retain the superseded hard/soft 24-hour target.
 for(const i of input.instructors)if(i.teachingRules?.preferredCreditedLoad!==undefined)i.teachingRules.preferredCreditedLoad=refinement.requiredCreditedLoads[i.id]!;
 for(const level of [2,4])input.projection!.baseBlocksByLevel[level]=input.cohortBlocks.filter(b=>b.level===level).length;
 input.projection!.assumptions.push('بتوجيه المستخدم وموافقته: إغلاق بلوكي 12 و17؛ الثاني 43/43/43/43 والرابع 49/48. استثناء سعة الطباعة العربية 43 واستخدام الحاسب 49 داخل هذه المسودة فقط. تبقى العامة وشعبها وسعاتها ومواعيدها ثابتة، وتوزيع العضويات العامة الجديدة معلق. الأنصبة تنخفض وفق الشعب الملغاة دون تعويض مصطنع.');
 validateRequest(input);return input;
}
