import type {PlanRequest,PlanResult} from './types.js';

export interface MasterTrainerCapacity {
 code:string;name:string;maxLoad:number;approvedExceptionHours:number;
}
const round=(value:number)=>Math.round(value*1000)/1000;
const effective=(base:number,exception:number)=>round(base+exception);

/** Read-only, minimal disclosure of load constraints for local operator diagnosis. */
export function diagnoseLoad24Capacity(
 input:PlanRequest,result:PlanResult,master:MasterTrainerCapacity[]=[]
){
 const masters=new Map(master.map(x=>[x.code,x]));
 return input.instructors.map(instructor=>{
  const code=instructor.id;
  const base=instructor.maxLoad,exception=instructor.overload?.additionalHours??0;
  const limit=effective(base,exception);
  const stored=result.instructorLoads.find(load=>load.id===code);
  const current=masters.get(code);
  const currentEffective=current?effective(current.maxLoad,current.approvedExceptionHours):null;
  return {
   code,name:instructor.name,
   scenarioBaseLimit:base,scenarioApprovedException:exception,scenarioEffectiveLimit:limit,
   currentCredited:stored?.credited??null,
   targetCredited:['5','6'].includes(code)?24:null,
   missingCapacityTo24:['5','6'].includes(code)?round(Math.max(0,24-limit)):null,
   masterBaseLimit:current?.maxLoad??null,
   masterApprovedException:current?.approvedExceptionHours??null,
   masterEffectiveLimit:currentEffective,
   snapshotDiffersFromMaster:current?(!Number.isFinite(currentEffective!)||
    !Number.isFinite(limit)||round(current.maxLoad)!==round(base)||
    round(current.approvedExceptionHours)!==round(exception)):null,
   targetFeasibleWithinSavedCapacity:['5','6'].includes(code)?limit>=24:null
  };
 });
}
