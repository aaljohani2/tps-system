import type {PlanRequest,PlanResult,Session} from './types.js';
import {stableGeneralLocks,campusDays} from './stable-blocks.js';

export interface RefinementWeights {
 studentGaps:number;studentDays:number;trainerGaps:number;trainerDays:number;changes:number;roomCount:number;coveragePenalty:number;
}
export interface ScheduleRefinement {
 version:1;baselineScenarioId:string;alternative:'A'|'B'|'C';seed:number;keepInstructors:boolean;
 referenceSessions:Session[];referenceInstructors:Record<string,string>;weights:RefinementWeights;
 initialSessions?:Session[];
 requiredCreditedLoads?:Record<string,number>;
 requiredCourseCodes?:string[];
}
export const refinementWeights:Record<'A'|'B'|'C',RefinementWeights>={
 A:{studentGaps:0,studentDays:0,trainerGaps:0,trainerDays:0,changes:500,roomCount:0,coveragePenalty:1000000},
 B:{studentGaps:10,studentDays:100,trainerGaps:1,trainerDays:1,changes:2,roomCount:1,coveragePenalty:1000000},
 C:{studentGaps:2,studentDays:20,trainerGaps:10,trainerDays:100,changes:2,roomCount:100,coveragePenalty:1000000}
};
export function validateRefinement(input:PlanRequest):void {
 const refinement=input.scheduleRefinement;if(!refinement)return;
 if(refinement.requiredCourseCodes&&(!Array.isArray(refinement.requiredCourseCodes)||new Set(refinement.requiredCourseCodes).size!==refinement.requiredCourseCodes.length||
  refinement.requiredCourseCodes.some(code=>!input.courses.some(c=>c.code===code&&c.assignmentScope!=='EXTERNAL'))))throw Error('Invalid required coverage courses');
 if(refinement.requiredCreditedLoads&&Object.entries(refinement.requiredCreditedLoads).some(([id,hours])=>{
  const i=input.instructors.find(i=>i.id===id);return !i||!Number.isInteger(hours)||hours<0||hours>i.maxLoad+(i.overload?.additionalHours??0);
 }))throw Error('Invalid required instructor loads');
 if(refinement.version!==1||!refinement.baselineScenarioId||!['A','B','C'].includes(refinement.alternative)||
  !Number.isSafeInteger(refinement.seed)||refinement.seed<0||refinement.seed>2147483647||typeof refinement.keepInstructors!=='boolean'||
  !Array.isArray(refinement.referenceSessions)||refinement.referenceSessions.length>1000||
  !refinement.referenceInstructors||Object.values(refinement.referenceInstructors).some(id=>!input.instructors.some(i=>i.id===id))||
  !refinement.weights||Object.entries(refinementWeights.A).some(([key])=>{
   const value=refinement.weights[key as keyof RefinementWeights];return !Number.isInteger(value)||value<0||value>1000000;
  })||refinement.weights.coveragePenalty<1000000)throw Error('Invalid scenario-specific refinement settings');
 if(refinement.initialSessions&&(!Array.isArray(refinement.initialSessions)||refinement.initialSessions.length>1000))throw Error('Invalid refinement initial meetings');
 for(const sessions of [refinement.referenceSessions,refinement.initialSessions??[]]){
  const seen=new Set<string>();
  for(const session of sessions){
  const course=input.courses.find(c=>c.code===session.courseCode);
  if(!course||course.assignmentScope==='EXTERNAL'||!session.id||seen.has(session.id)||
   !session.sectionId.startsWith(course.code+'-')||!input.instructors.some(i=>i.id===session.instructorId)||
   !['SUN','MON','TUE','WED','THU'].includes(session.day)||!Number.isFinite(session.start)||!Number.isFinite(session.end)||
   session.start<0||session.end>24||session.end<=session.start)throw Error('Invalid refinement reference meeting');
  seen.add(session.id);
  }
 }
}

type Interval={day:string;start:number;end:number;onsite:boolean};
export function intervalQuality(intervals:Interval[]){
 let idleMinutes=0,avoidableGapMinutes=0,days=0,splitDays=0,overlapMinutes=0;
 for(const day of ['SUN','MON','TUE','WED','THU']){
  const rows=intervals.filter(s=>s.day===day).sort((a,b)=>a.start-b.start||a.end-b.end);if(!rows.length)continue;
  days++;if(rows.some(r=>r.start<12*60)&&rows.some(r=>r.start>=16*60))splitDays++;
  let end=rows[0]!.end;
  for(const row of rows.slice(1)){
   if(row.start>end){const gap=row.start-end;idleMinutes+=gap;avoidableGapMinutes+=Math.max(0,gap-20);}
   else overlapMinutes+=Math.max(0,Math.min(end,row.end)-row.start);
   end=Math.max(end,row.end);
  }
 }
 return {idleMinutes,avoidableGapMinutes,days,splitDays,overlapMinutes};
}
/** Exact student-size weighting over anonymous membership partitions, with no invented external meetings. */
export function measureSchedule(input:PlanRequest,result:PlanResult,reference:PlanResult|undefined=undefined){
 const locks=[...(input.generalCourseSchedule?.locks??[]),...stableGeneralLocks(input)];
 const all=[...result.sessions.map(s=>({day:s.day,start:Math.round(s.start*60),end:Math.round(s.end*60),onsite:s.mode==='ONSITE',blockIds:s.blockIds??(s.blockId?[s.blockId]:[])})),
  ...locks.map(l=>({day:l.day,start:l.startMinute,end:l.endMinute,onsite:l.mode==='ONSITE',blockIds:l.blockIds}))];
 const students=input.cohortBlocks?.reduce((n,b)=>n+b.size,0)??0;
 let idle=0,avoidable=0,attendance=0,activeStudentDays=0,split=0,overlaps=0;
 const byBlock=(input.cohortBlocks??[]).map(block=>{
  const quality=intervalQuality(all.filter(s=>s.blockIds.includes(block.ref)));
  idle+=quality.idleMinutes*block.size;avoidable+=quality.avoidableGapMinutes*block.size;
  attendance+=quality.days*block.size;activeStudentDays+=quality.days*block.size;split+=quality.splitDays*block.size;overlaps+=quality.overlapMinutes*block.size;
  return {blockId:block.ref,level:block.level,students:block.size,...quality};
 });
 const byTrainer=input.instructors.map(instructor=>({id:instructor.id,name:instructor.name,
  ...intervalQuality(result.sessions.filter(s=>s.instructorId===instructor.id).map(s=>({day:s.day,start:Math.round(s.start*60),end:Math.round(s.end*60),onsite:s.mode==='ONSITE'})))}));
 const signature=(sessions:Session[])=>sessions.map(s=>[s.day,Math.round(s.start*60),Math.round(s.end*60),s.roomId,s.instructorId,s.component].join('/')).sort().join('|');
 const referenceSessions=reference?.sessions??input.scheduleRefinement?.referenceSessions??[];
 const changedSections=result.sections.filter(s=>signature(result.sessions.filter(m=>m.sectionId===s.id))!==signature(referenceSessions.filter(m=>m.sectionId===s.id))).length;
 const externalRequired=(result.externalSections??[]).reduce((n,s)=>n+s.contactHours,0),externalFixed=locks.reduce((n,l)=>n+l.trainingHours,0);
 return {population:students,cooperativeStudents:input.projection?.cooperativeStudents??0,departmentSections:result.sections.length,
  scheduled:result.sections.filter(s=>s.state==='SCHEDULED').length,gaps:result.gaps.length,
  studentWeightedIdleMinutes:idle,studentWeightedAvoidableGapMinutes:avoidable,
  meanWeeklyIdleMinutes:students?idle/students:null,meanWeeklyAvoidableGapMinutes:students?avoidable/students:null,
  meanIdleMinutesPerActiveStudentDay:activeStudentDays?idle/activeStudentDays:null,
  meanAttendanceDays:students?(input.stableBlockPlan?campusDays(input,result.sessions).reduce((n,b)=>n+b.campusDayCount*b.students,0):attendance)/students:null,studentWeightedSplitDays:split,studentWeightedOverlapMinutes:overlaps,
  trainerIdleMinutes:byTrainer.reduce((n,t)=>n+t.idleMinutes,0),trainerAvoidableGapMinutes:byTrainer.reduce((n,t)=>n+t.avoidableGapMinutes,0),
  trainerAttendanceDays:byTrainer.reduce((n,t)=>n+t.days,0),roomsUsed:new Set(result.sessions.map(s=>s.roomId).filter(Boolean)).size,
  changedSections,externalSections:input.stableBlockPlan?null:result.externalSections?.length??0,
  externalDemandBlockCount:input.stableBlockPlan?result.externalSections?.length??0:null,
  externalRequiredSectionTrainingHours:input.stableBlockPlan?null:externalRequired,
  externalFixedSectionTrainingHours:input.stableBlockPlan?null:externalFixed,externalPendingSectionTrainingHours:input.stableBlockPlan?null:externalRequired-externalFixed,
  generalCoverageComplete:!input.stableBlockPlan&&externalRequired===externalFixed&&!(input.generalCourseSchedule?.issues.length),
  metricsScope:locks.length?'INTERNAL_AND_DOCUMENTED_PROVISIONAL_GENERAL_ONLY':'INTERNAL_ONLY',byBlock,byTrainer};
}
