import {DAYS, MODES} from './policy.js';
import type {Course, PlanRequest, Policy, TimeWindow} from './types.js';
import {sectionCapacity} from './section-capacity.js';

const positiveInt = (v: number) => Number.isInteger(v) && v > 0;
const hours = (v: number) => Number.isInteger(v) && v >= 0;
const validCodes=(v:string[]|undefined)=>v===undefined || (Array.isArray(v)&&v.length<=30&&new Set(v).size===v.length&&v.every(x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(x)));

function validWindow(w: TimeWindow,fixed=false): boolean {
  return DAYS.includes(w.day) && Number.isInteger(w.from*2) && Number.isInteger(w.to*2)
    && w.from >= 0 && w.to <= 24 && w.from < w.to
    && (fixed||!(w.day === 'THU' && w.to > 10));
}
function validatePolicy(p: Policy, errors: string[]): void {
  if(p.priorityCourseCodes!==undefined&&(!Array.isArray(p.priorityCourseCodes)||p.priorityCourseCodes.length>30||
    new Set(p.priorityCourseCodes).size!==p.priorityCourseCodes.length||
    p.priorityCourseCodes.some(code=>typeof code!=='string'||!code.trim()||code.length>60)))errors.push('Invalid priority course codes.');
  if(p.lecturePeriods){
    const fixed=p.lecturePeriods;
    const validPeriods=(periods:typeof fixed.regular)=>Array.isArray(periods)&&periods.length>0&&periods.length<=12&&
      periods.every(period=>Number.isInteger(period.startMinute)&&Number.isInteger(period.endMinute)&&period.startMinute>=0&&
        period.endMinute<=1440&&period.endMinute>period.startMinute&&positiveInt(period.trainingHours)&&
        period.endMinute-period.startMinute===period.trainingHours*fixed.academicHourMinutes)&&
      new Set(periods.map(period=>period.startMinute)).size===periods.length;
    if(!positiveInt(fixed.academicHourMinutes)||fixed.academicHourMinutes>60||!['TRIM_END','FULL_PERIOD'].includes(fixed.partialPeriod)||
      !validPeriods(fixed.regular)||!fixed.courseOverrides||Object.entries(fixed.courseOverrides).some(([code,override])=>
        !code.trim()||!validPeriods(override.periods)||typeof override.allowCohortOverlap!=='boolean'))errors.push('Invalid fixed lecture-period policy');
    if(p.enabledModes.some(mode=>mode!=='ONSITE'))errors.push('Fixed lecture periods currently require onsite-only policy');
  }
  if(p.ignoreRoomCapacity!==undefined&&typeof p.ignoreRoomCapacity!=='boolean')errors.push('Invalid room-capacity planning option.');
  if(p.courseSectionCapacities&&Object.entries(p.courseSectionCapacities).some(([code,capacity])=>
    !code.trim()||code.length>60||!positiveInt(capacity)||capacity>5000))errors.push('Invalid explicit course-capacity exception.');
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
  if (!Array.isArray(p.slots) || p.slots.some(s => !validWindow(s,!!p.lecturePeriods))) errors.push('Invalid time window or Thursday after 10:00.');
}
function validateCourse(c: Course, p: Policy, errors: string[],cohortBlocks?:PlanRequest['cohortBlocks']): void {
  if (!c.code || !c.title || !positiveInt(c.level)) errors.push(`Invalid course identity: ${c.code}`);
  if(c.assignmentScope!==undefined&&!['DEPARTMENT','EXTERNAL'].includes(c.assignmentScope))errors.push(`Invalid assignment scope: ${c.code}`);
  if(c.assignmentScope==='EXTERNAL'&&p.priorityCourseCodes?.includes(c.code))errors.push(`Priority coverage requires department ownership: ${c.code}`);
  if(c.externalSectionCapacity!==undefined&&(!positiveInt(c.externalSectionCapacity)||c.externalSectionCapacity>5000))errors.push(`Invalid external section capacity: ${c.code}`);
  if(!validCodes(c.requiredSpecialties)||!validCodes(c.requiredEquipment))errors.push(`Invalid specialty or equipment requirements for ${c.code}`);
  if (!Number.isInteger(c.demand) || c.demand < 0) errors.push(`Invalid demand for ${c.code}`);
  if(c.sectionCapacity!==undefined&&(!positiveInt(c.sectionCapacity)||c.sectionCapacity>5000||c.mode==='SELF_PACED'))
    errors.push(`Invalid scenario section capacity for ${c.code}`);
  if (!hours(c.theoryHours) || !hours(c.practicalHours) || c.theoryHours + c.practicalHours === 0) errors.push(`Invalid contact hours for ${c.code}`);
  if(!MODES.includes(c.mode))errors.push(`Unknown course delivery mode: ${c.code}`);
  if (c.assignmentScope!=='EXTERNAL'&&!p.enabledModes.includes(c.mode)) errors.push(`Mode ${c.mode} is disabled for ${c.code}`);
  if (c.assignmentScope!=='EXTERNAL'&&!c.eligibleModes?.includes(c.mode)) errors.push(`Mode ${c.mode} is not approved for ${c.code}`);
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
  if(c.blockGroups){
    if(!c.blocks||!c.blockSizes||c.blockGroups.length!==c.blocks.length||
      c.blockGroups.some((members,index)=>!members.length||
        new Set(members).size!==members.length||
        members.some(member=>typeof member!=='string'||!member)||
        c.blocks?.[index]!==members.join(' + '))||
      new Set(c.blockGroups.flat()).size!==c.blockGroups.flat().length)
      errors.push(`Invalid or duplicated grouped cohort identities for ${c.code}`);
    if((c.practicalHours>0&&!cohortBlocks) || c.mode==='SELF_PACED')
      errors.push(`Cannot combine groups for practical or self-paced course ${c.code}`);
  }
  if(c.blockSizes){
    if(!c.blocks || c.blockSizes.length!==c.blocks.length || !c.blockSizes.length ||
      c.blockSizes.some(s=>!positiveInt(s)) ||
      c.blockSizes.reduce((sum,n)=>sum+n,0)!==c.demand)
      errors.push(`Normalized blocks must sum to the exact demand of ${c.code}`);
    const capacity=sectionCapacity(c,p);
    if(capacity!==null && c.blockSizes.some(s=>s>capacity!))
      errors.push(`Block size exceeds course section capacity for ${c.code}`);
  }
  if(cohortBlocks&&c.demand>0){
    const known=new Map(cohortBlocks.map(block=>[block.ref,block]));
    const memberships=c.blockGroups??c.blocks?.map(ref=>[ref]);
    const members=memberships?.flat()??[];
    const expected=cohortBlocks.filter(block=>block.level===c.level).map(block=>block.ref);
    if(!memberships||new Set(members).size!==members.length||members.length!==expected.length||
      expected.some(ref=>!members.includes(ref))||memberships.some((group,index)=>
        group.some(ref=>known.get(ref)?.level!==c.level)||
        group.reduce((n,ref)=>n+(known.get(ref)?.size??0),0)!==c.blockSizes?.[index]))
      errors.push(`Anonymous cohort membership does not reconcile for ${c.code}`);
  }
}
export function validateRequest(input: PlanRequest): void {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') throw new Error('Invalid request.');
  if (!input.scenarioName?.trim() || !input.termId?.trim()) errors.push('Scenario name and term are required.');
  if (!Array.isArray(input.courses) || !Array.isArray(input.instructors) || !Array.isArray(input.rooms) || !input.policy) throw new Error('courses, instructors, rooms and policy are required.');
  validatePolicy(input.policy, errors);
  if(input.cohortBlocks&&(!Array.isArray(input.cohortBlocks)||input.cohortBlocks.some(block=>
    !block.ref||!positiveInt(block.level)||!positiveInt(block.size))||
    new Set(input.cohortBlocks.map(block=>block.ref)).size!==input.cohortBlocks.length))
    errors.push('Invalid anonymous cohort blocks');
  const codes = new Set<string>();
  for (const c of input.courses) {
    if (codes.has(c.code)) errors.push(`Duplicate course code: ${c.code}`);
    codes.add(c.code);
    validateCourse(c, input.policy, errors,input.cohortBlocks);
  }
  const ids = new Set<string>();
  for (const i of input.instructors) {
    if (ids.has(i.id)) errors.push(`Duplicate instructor: ${i.id}`);
    ids.add(i.id);
    if (!i.id || !i.name || !Number.isFinite(i.maxLoad) || i.maxLoad < 0) errors.push(`Invalid instructor: ${i.id}`);
    const rules=i.teachingRules;
    if(rules){
      if(rules.preferredCreditedLoad!==undefined&&(!Number.isFinite(rules.preferredCreditedLoad)||rules.preferredCreditedLoad<0||rules.preferredCreditedLoad>168||rules.preferredCreditedLoad>i.maxLoad))errors.push(`Invalid instructor credited-load target: ${i.id}`);
      if(rules.maxContactHours!==undefined&&(!Number.isFinite(rules.maxContactHours)||rules.maxContactHours<0||rules.maxContactHours>168))errors.push(`Invalid instructor contact limit: ${i.id}`);
      for(const key of ['maxSections','preferredSections'] as const)
        if(rules[key]!==undefined&&(!Number.isInteger(rules[key])||rules[key]!<0||rules[key]!>250))errors.push(`Invalid instructor section limit: ${i.id}`);
      if(rules.maxSections!==undefined&&rules.preferredSections!==undefined&&rules.preferredSections>rules.maxSections)errors.push(`Preferred sections exceed instructor section limit: ${i.id}`);
      for(const key of ['allowedCourseTypes','preferredCourseTypes'] as const)
        if(rules[key]!==undefined&&(!Array.isArray(rules[key])||rules[key]!.some(type=>!['THEORY','PRACTICAL','MIXED'].includes(type))||new Set(rules[key]).size!==rules[key]!.length))errors.push(`Invalid instructor course types: ${i.id}`);
    }
    if(!validCodes(i.specialties))errors.push(`Invalid instructor specialties: ${i.id}`);
    if (!i.allowedModes?.every(m => MODES.includes(m))) errors.push(`Invalid instructor modes: ${i.id}`);
    if (i.available?.some(w => !validWindow(w,!!input.policy.lecturePeriods))) errors.push(`Invalid instructor availability: ${i.id}`);
    if (i.overload && (!Number.isFinite(i.overload.additionalHours) || i.overload.additionalHours <= 0 || !i.overload.reason?.trim())) errors.push(`Overload needs amount and reason: ${i.id}`);
  }
  for (const c of input.courses) if (c.assignmentScope!=='EXTERNAL'&&c.assignedInstructorId && !ids.has(c.assignedInstructorId)) errors.push(`Locked instructor not found for ${c.code}`);
  const roomIds = new Set<string>();
  for (const r of input.rooms) {
    if (roomIds.has(r.id)) errors.push(`Duplicate room: ${r.id}`);
    roomIds.add(r.id);
    if (!r.id || !r.name || (r.capacity!==null&&!positiveInt(r.capacity)) ||
      (r.type!==null&&!['CLASSROOM', 'LAB', 'MULTI'].includes(r.type))) errors.push(`Invalid room: ${r.id}`);
    if(!validCodes(r.equipmentCodes))errors.push(`Invalid room equipment identifiers: ${r.id}`);
    if (r.available?.some(w => !validWindow(w,!!input.policy.lecturePeriods))) errors.push(`Invalid room availability: ${r.id}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
}
