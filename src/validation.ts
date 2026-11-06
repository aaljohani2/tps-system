import {DAYS, MODES} from './policy.js';
import type {Course, PlanRequest, Policy, TimeWindow} from './types.js';

const positiveInt = (v: number) => Number.isInteger(v) && v > 0;
const hours = (v: number) => Number.isInteger(v) && v >= 0;
function validWindow(w: TimeWindow): boolean {
  return DAYS.includes(w.day) && Number.isInteger(w.from) && Number.isInteger(w.to)
    && w.from >= 0 && w.to <= 24 && w.from < w.to
    && !(w.day === 'THU' && w.to > 10);
}
function validatePolicy(p: Policy, errors: string[]): void {
  for (const mode of p.enabledModes) if (!MODES.includes(mode)) errors.push(`Unknown enabled mode: ${mode}`);
  if (!p.enabledModes.includes('ONSITE')) errors.push('ONSITE must remain enabled.');
  for (const mode of MODES) {
    const cap = p.capacities?.[mode];
    if (!cap) {errors.push(`Missing capacity policy: ${mode}`); continue;}
    if (mode === 'SELF_PACED') {
      if (cap.theory !== null || cap.practical !== null) errors.push('SELF_PACED capacity must be null (unlimited).');
    } else if (!positiveInt(cap.theory!) || !positiveInt(cap.practical!)) errors.push(`Invalid ${mode} capacities.`);
  }
  if (!Number.isFinite(p.remotePracticalLoadFactor) || p.remotePracticalLoadFactor <= 0) errors.push('Invalid remote practical load factor.');
  if (!Number.isFinite(p.onsitePracticalLoadFactor) || p.onsitePracticalLoadFactor <= 0) errors.push('Invalid onsite practical load factor.');
  if (p.selfPacedLoadPerOffering !== null && (!Number.isFinite(p.selfPacedLoadPerOffering) || p.selfPacedLoadPerOffering < 0)) errors.push('Invalid self-paced load policy.');
  if (!positiveInt(p.sessionMaxHours)) errors.push('sessionMaxHours must be a positive integer.');
  if (!Array.isArray(p.slots) || p.slots.some(s => !validWindow(s))) errors.push('Invalid time window or Thursday after 10:00.');
}
function validateCourse(c: Course, p: Policy, errors: string[]): void {
  if (!c.code || !c.title || !positiveInt(c.level)) errors.push(`Invalid course identity: ${c.code}`);
  if (!Number.isInteger(c.demand) || c.demand < 0) errors.push(`Invalid demand for ${c.code}`);
  if (!hours(c.theoryHours) || !hours(c.practicalHours) || c.theoryHours + c.practicalHours === 0) errors.push(`Invalid contact hours for ${c.code}`);
  if (!p.enabledModes.includes(c.mode)) errors.push(`Mode ${c.mode} is disabled for ${c.code}`);
  if (!c.eligibleModes?.includes(c.mode)) errors.push(`Mode ${c.mode} is not approved for ${c.code}`);
  if (c.hybridSplit && c.mode !== 'HYBRID') errors.push(`Hybrid split provided to non-hybrid ${c.code}`);
  if (c.mode === 'HYBRID') {
    const s = c.hybridSplit;
    if (!s || ![s.theoryOnsiteHours, s.theoryRemoteHours, s.practicalOnsiteHours, s.practicalRemoteHours].every(hours) ||
        s.theoryOnsiteHours + s.theoryRemoteHours !== c.theoryHours ||
        s.practicalOnsiteHours + s.practicalRemoteHours !== c.practicalHours ||
        (s.theoryOnsiteHours + s.practicalOnsiteHours === 0) ||
        (s.theoryRemoteHours + s.practicalRemoteHours === 0)) errors.push(`HYBRID ${c.code} needs explicit valid onsite and remote hour split.`);
  }
  if (c.mode === 'SELF_PACED' && p.selfPacedLoadPerOffering === null) errors.push(`SELF_PACED ${c.code} needs an approved load policy.`);
  if (c.blocks && (c.blocks.length === 0 || c.blocks.some(x => !x))) errors.push(`Invalid block identifiers for ${c.code}`);
  if(c.blocks && new Set(c.blocks).size!==c.blocks.length)errors.push(`Duplicate block assignments for ${c.code}`);
  if(c.blockSizes){
    if(!c.blocks || c.blockSizes.length!==c.blocks.length || !c.blockSizes.length ||
      c.blockSizes.some(s=>!positiveInt(s)) ||
      c.blockSizes.reduce((sum,n)=>sum+n,0)!==c.demand)
      errors.push(`Normalized blocks must sum to the exact demand of ${c.code}`);
    const capacity=c.mode==='SELF_PACED'?null:c.theoryHours&&c.practicalHours?
      Math.min(p.capacities[c.mode].theory!,p.capacities[c.mode].practical!):
      c.theoryHours?p.capacities[c.mode].theory:p.capacities[c.mode].practical;
    if(capacity!==null && c.blockSizes.some(s=>s>capacity!))
      errors.push(`Block size exceeds course section capacity for ${c.code}`);
  }
}
export function validateRequest(input: PlanRequest): void {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') throw new Error('Invalid request.');
  if (!input.scenarioName?.trim() || !input.termId?.trim()) errors.push('Scenario name and term are required.');
  if (!Array.isArray(input.courses) || !Array.isArray(input.instructors) || !Array.isArray(input.rooms) || !input.policy) throw new Error('courses, instructors, rooms and policy are required.');
  validatePolicy(input.policy, errors);
  const codes = new Set<string>();
  for (const c of input.courses) {
    if (codes.has(c.code)) errors.push(`Duplicate course code: ${c.code}`);
    codes.add(c.code);
    validateCourse(c, input.policy, errors);
  }
  const ids = new Set<string>();
  for (const i of input.instructors) {
    if (ids.has(i.id)) errors.push(`Duplicate instructor: ${i.id}`);
    ids.add(i.id);
    if (!i.id || !i.name || !Number.isFinite(i.maxLoad) || i.maxLoad < 0) errors.push(`Invalid instructor: ${i.id}`);
    if (!i.allowedModes?.every(m => MODES.includes(m))) errors.push(`Invalid instructor modes: ${i.id}`);
    if (i.available?.some(w => !validWindow(w))) errors.push(`Invalid instructor availability: ${i.id}`);
    if (i.overload && (!Number.isFinite(i.overload.additionalHours) || i.overload.additionalHours <= 0 || !i.overload.reason?.trim())) errors.push(`Overload needs amount and reason: ${i.id}`);
  }
  for (const c of input.courses) if (c.assignedInstructorId && !ids.has(c.assignedInstructorId)) errors.push(`Locked instructor not found for ${c.code}`);
  const roomIds = new Set<string>();
  for (const r of input.rooms) {
    if (roomIds.has(r.id)) errors.push(`Duplicate room: ${r.id}`);
    roomIds.add(r.id);
    if (!r.id || !r.name || !positiveInt(r.capacity) || !['CLASSROOM', 'LAB', 'MULTI'].includes(r.type)) errors.push(`Invalid room: ${r.id}`);
    if (r.available?.some(w => !validWindow(w))) errors.push(`Invalid room availability: ${r.id}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
}
