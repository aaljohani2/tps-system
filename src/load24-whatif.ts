import type {PlanRequest} from './types.js';
import {prepareLoad24Input} from './load24-verification.js';
import {splitTeachingSections} from './load-targets.js';

/**
 * Temporary mathematical feasibility only, NOT an approved teaching-load exception.
 * Never store this prepared input, pass it to the real commit workflow or API, or
 * interpret its results as authority to exceed the original instructor limit.
 */
export function makeUnapprovedMohammed24WhatIf(source:PlanRequest):PlanRequest {
 const original=structuredClone(source);
 const mohammed=original.instructors.find(i=>i.id==='6');
 const fahd=original.instructors.find(i=>i.id==='5');
 if(!mohammed||!fahd)throw Error('WHATIF: trainer codes 5 and 6 are required');
 if(!mohammed.name.includes('محمد')||!fahd.name.includes('فهد'))
  throw Error('WHATIF: trainer code/name identity mismatch');
 if(mohammed.maxLoad!==22||mohammed.overload!==undefined)
  throw Error('WHATIF: expected exact 22 base, zero approved exception for trainer 6');
 if(fahd.maxLoad!==24||fahd.overload!==undefined)
  throw Error('WHATIF: expected exact 24 base, zero approved exception for trainer 5');
 // In-memory only. There is NO permission or database write associated with this.
 mohammed.overload={additionalHours:2,reason:'HYPOTHETICAL UNAPPROVED +2 HOURS — SIMULATION ONLY'};
 const prepared=prepareLoad24Input(original,splitTeachingSections);
 if(prepared.instructors.find(i=>i.id==='6')?.maxLoad!==22)
  throw Error('WHATIF: official base changed unexpectedly');
 return prepared;
}
