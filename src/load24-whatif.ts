import type {PlanRequest} from './types.js';
import {prepareLoad24Input} from './load24-verification.js';
import {splitTeachingSections} from './load-targets.js';

/**
 * Temporary mathematical feasibility only, NOT an approved teaching-load exception.
 * Never store this prepared input, pass it to the real commit workflow or API, or
 * interpret its results as authority to exceed the original instructor limit.
 */
export function makeUnapprovedTrainer6CapacityWhatIf(source:PlanRequest,verified:{trainer5Name:string;trainer6Name:string}):{simulationSource:PlanRequest;input:PlanRequest} {
 const original=structuredClone(source);
 const trainer6=original.instructors.find(i=>i.id==='6');
 const trainer5=original.instructors.find(i=>i.id==='5');
 if(!trainer6||!trainer5)throw Error('WHATIF: trainer codes 5 and 6 are required');
 if(!verified?.trainer5Name?.trim()||!verified?.trainer6Name?.trim()||verified.trainer5Name.trim()===verified.trainer6Name.trim())
  throw Error('WHATIF: distinct verified local trainer identities are required');
 if(trainer6.name.trim()!==verified.trainer6Name.trim()||trainer5.name.trim()!==verified.trainer5Name.trim())
  throw Error('WHATIF: trainer code/name identity mismatch');
 if(trainer6.maxLoad!==22||trainer6.overload!==undefined)
  throw Error('WHATIF: expected exact 22 base, zero approved exception for trainer 6');
 if(trainer5.maxLoad!==24||trainer5.overload!==undefined)
  throw Error('WHATIF: expected exact 24 base, zero approved exception for trainer 5');
 // In-memory only. There is NO permission or database write associated with this.
 trainer6.overload={additionalHours:2,reason:'HYPOTHETICAL UNAPPROVED +2 HOURS — SIMULATION ONLY'};
 const prepared=prepareLoad24Input(original,splitTeachingSections);
 if(prepared.instructors.find(i=>i.id==='6')?.maxLoad!==22)
  throw Error('WHATIF: official base changed unexpectedly');
 return {simulationSource:original,input:prepared};
}
