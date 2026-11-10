/**
 * Experimental Timefold bridge. Candidate placements are atomic at the section level:
 * a choice carries all of its theory/practical sessions or leaves the entire section uncovered.
 * Timefold selects between bounded candidate placements; this is NOT yet free-form search.
 */
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Component, Course, Day, Instructor, PlanRequest, PlanResult, Room, Section, Session, TimedMode, TimeWindow} from './types.js';
import {buildDraftPlan} from './planner.js';
import {trainerQualified,roomQualified} from './eligibility.js';
import {hasSharedBlock} from './cohort-grouping.js';
import {typePreference,instructorTotals,exceedsTeachingLimits} from './instructor-rules.js';
import {trainingHours,hardSessionConflict,validPeriodSession} from './lecture-periods.js';
import {makePeriodSessions} from './period-scheduler.js';
import {conflictsWithGeneral} from './general-courses.js';
import type {RefinementWeights} from './schedule-refinement.js';
import {stableGeneralLocks} from './stable-blocks.js';

const DAYS: Day[] = ['SUN', 'MON', 'TUE', 'WED', 'THU'];
const round = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const collide = (a: {start: number; end: number}, b: {start: number; end: number}) => a.start < b.end && b.start < a.end;

export interface AtomicCandidate {
  id: string;
  sectionId: string;
  courseCode: string;
  instructorId: string | null;
  creditedMilli: number;
  effectiveLimitMilli: number;
  uncovered: boolean;
  sessions: Session[];
  contactLimitMilli?: number;
  sectionLimit?: number;
  preferredSectionCount?: number;
  preferredCreditedMilli?: number;
  preferenceScore?: number;
}
export interface AtomicTask {
  id: string;
  courseCode: string;
  level: number;
  contactHours: number;
  priorityCoverage?: boolean;
  exclusiveInstructor: boolean;
  choices: AtomicCandidate[];
  initialCandidateId?: string;
}
export interface SolverPayload {schemaVersion: 'tps.timefold.v1'; tasks: AtomicTask[]; seconds: number;
 refinement?:{blockSizes:Record<string,number>;fixedSessions:Session[];referenceSessions:Session[];weights:RefinementWeights;maxCampusDays?:number;requiredCreditedLoads?:Record<string,number>};seed?:number}
export interface SolverChoice {taskId: string; candidateId: string}
export interface SolverResponse {schemaVersion: 'tps.timefold.v1'; choices: SolverChoice[]; hardScore: number; softScore: number}

function eligible(inst: Instructor, c: Course): boolean {return trainerQualified(inst,c);}
function jobs(c: Course): Array<{component: Component; mode: TimedMode; hours: number}> {
  if (c.mode === 'SELF_PACED') return [];
  if (c.mode === 'HYBRID') {
    const h = c.hybridSplit!;
    return [
      {component: 'THEORY', mode: 'ONSITE', hours: h.theoryOnsiteHours},
      {component: 'THEORY', mode: 'REMOTE', hours: h.theoryRemoteHours},
      {component: 'PRACTICAL', mode: 'ONSITE', hours: h.practicalOnsiteHours},
      {component: 'PRACTICAL', mode: 'REMOTE', hours: h.practicalRemoteHours}
    ].filter(j => j.hours > 0) as Array<{component: Component; mode: TimedMode; hours: number}>;
  }
  return [
    {component: 'THEORY' as Component, mode: c.mode as TimedMode, hours: c.theoryHours},
    {component: 'PRACTICAL' as Component, mode: c.mode as TimedMode, hours: c.practicalHours}
  ].filter(j => j.hours > 0);
}
function available(windows: TimeWindow[] | undefined, day: Day, start: number, end: number) {
  return !windows || windows.some(w => w.day === day && w.from <= start && end <= w.to);
}
function compatible(room: Room, course: Course, component: Component, students: number,ignoreCapacity=false): boolean {
  return roomQualified(room,course,component,students,ignoreCapacity);
}
/** Alternative atomic schedules for one trainer; never share the section with another trainer. */
function makeSessions(c: Course, sec: Section, inst: Instructor, input: PlanRequest, seed: number): Session[] | null {
  if(input.policy.lecturePeriods&&c.mode==='ONSITE')return makePeriodSessions(c,sec,inst,input,jobs(c),[],seed);
  const allocated: Session[] = [];
  // Spread rooms across eligible instructors as well as temporal candidate seeds.
  // Previously all instructors chose rooms[seed], so even 20 available rooms
  // collapsed to one room per candidate seed and produced artificial shortages.
  const instructorRoomOffset=Array.from(inst.id).reduce((h,ch)=>((h*33)+ch.charCodeAt(0))>>>0,0);
  const days = [...DAYS.slice(seed % DAYS.length), ...DAYS.slice(0, seed % DAYS.length)];
  for (const job of jobs(c)) {
    let hours = job.hours;
    while (hours > 0) {
      const durationOptions = [...new Set([Math.min(hours, input.policy.sessionMaxHours), Math.min(hours,1), 0.5])];
      let found = false;
      for (const duration of durationOptions) {
        if (found) break;
        for (const day of days) {
          if (found) break;
          const windows = input.policy.slots.filter(w => w.day === day);
          for (const window of windows) {
            if (found) break;
            const starts = Array.from({length: Math.max(0, Math.floor((window.to-window.from-duration)*2)+1)}, (_, i) => window.from+i/2);
            const rotatedStarts = [...starts.slice(seed % (starts.length || 1)), ...starts.slice(0, seed % (starts.length || 1))];
            for (const start of rotatedStarts) {
              const end = start + duration;
              if (day === 'THU' && end > 10) continue;
              if (c.mode === 'HYBRID' && job.mode === 'ONSITE' && end > 12) continue;
              if (c.mode === 'HYBRID' && job.mode === 'REMOTE' && (start < 16 || end > 22)) continue;
              if (!available(inst.available, day, start, end)) continue;
              if (allocated.some(x => x.day === day && collide(x, {start, end}))) continue;
              const rooms = job.mode === 'REMOTE' ? [null] : input.rooms.filter(r => compatible(r,c,job.component,sec.students,input.policy.ignoreRoomCapacity===true) && available(r.available, day, start, end));
              if (!rooms.length) continue;
              const chosen = rooms[(instructorRoomOffset+seed) % rooms.length];
              allocated.push({
                id: `${sec.id}-P${seed + 1}-${allocated.length + 1}`, sectionId: sec.id,
                courseCode: c.code, component: job.component, mode: job.mode,
                day, start, end, roomId: chosen?.id ?? null, instructorId: inst.id,
                blockId: sec.blockId,
                ...(sec.blockIds?{blockIds:sec.blockIds}:{})
              });
              hours -= duration;
              found = true;
              break;
            }
          }
        }
      }
      if (!found) return null;
    }
  }
  return allocated;
}

export function prepareSolverPayload(input: PlanRequest, maxChoicesPerInstructor = 6): SolverPayload {
  if (!Number.isInteger(maxChoicesPerInstructor) || maxChoicesPerInstructor < 1 || maxChoicesPerInstructor > (input.stableBlockPlan?48:24)) throw new Error('Invalid candidate limit');
  const draft = buildDraftPlan(input); // validates course/policy/instructor/room schema.
  if (draft.sections.length > 250) throw new Error('Experimental optimizer supports at most 250 sections per scenario.');
  const courses = new Map(input.courses.map(c => [c.code, c]));
  const seedFromPreview=!!input.policy.priorityCourseCodes?.length||input.instructors.some(instructor=>instructor.teachingRules&&Object.keys(instructor.teachingRules).length>0);
  const limits=(inst:Instructor,course:Course)=>({
    ...(inst.teachingRules?.maxContactHours!==undefined?{contactLimitMilli:Math.round(inst.teachingRules.maxContactHours*1000)}:{}),
    ...(inst.teachingRules?.maxSections!==undefined?{sectionLimit:inst.teachingRules.maxSections}:{}),
    ...(inst.teachingRules?.preferredSections!==undefined?{preferredSectionCount:inst.teachingRules.preferredSections}:{}),
    ...(inst.teachingRules?.preferredCreditedLoad!==undefined?{preferredCreditedMilli:Math.round(inst.teachingRules.preferredCreditedLoad*1000)}:{}),
    ...(typePreference(inst,course)?{preferenceScore:typePreference(inst,course)}:{})
  });
  const tasks: AtomicTask[] = draft.sections.map(sec => {
    const course = courses.get(sec.courseCode)!;
    const choices: AtomicCandidate[] = [{
      id: `${sec.id}:UNCOVERED`, sectionId: sec.id, courseCode: course.code,
      instructorId: null, creditedMilli: 0, effectiveLimitMilli: 0,
      uncovered: true, sessions: []
    }];
    let initialCandidateId=choices[0]!.id;
    const referenceInstructor=input.scheduleRefinement?.referenceInstructors[sec.id];
    for (const inst of input.instructors.filter(i => eligible(i, course)&&
      (!input.scheduleRefinement?.keepInstructors||!referenceInstructor||i.id===referenceInstructor))) {
      const count = course.mode === 'SELF_PACED' ? 1 : maxChoicesPerInstructor;
      const signatures = new Set<string>();
      const sourceReference=input.scheduleRefinement?.referenceSessions.filter(s=>s.sectionId===sec.id&&s.instructorId===inst.id)
        .map(s=>({...s,blockId:sec.blockId,blockIds:sec.blockIds}));
      const warmReference=(input.scheduleRefinement?.initialSessions??input.scheduleRefinement?.referenceSessions)?.filter(s=>s.sectionId===sec.id&&s.instructorId===inst.id)
        .map(s=>({...s,blockId:sec.blockId,blockIds:sec.blockIds}));
      const validReference=(reference:Session[]|undefined)=>reference?.length&&reference.every(s=>s.courseCode===course.code&&
        available(input.policy.slots,s.day,s.start,s.end)&&available(inst.available,s.day,s.start,s.end)&&
        (!input.policy.lecturePeriods||validPeriodSession(s,input.policy))&&
        (s.mode==='REMOTE'?s.roomId===null:input.rooms.some(r=>r.id===s.roomId&&compatible(r,course,s.component,sec.students,input.policy.ignoreRoomCapacity===true)&&available(r.available,s.day,s.start,s.end))))&&
        (['THEORY','PRACTICAL'] as const).every(component=>Math.abs(reference.filter(s=>s.component===component).reduce((n,s)=>n+trainingHours(s,input.policy),0)-
          (component==='THEORY'?course.theoryHours:course.practicalHours))<1e-8)&&!conflictsWithGeneral(input,reference)&&
        !reference.some((a,i)=>reference.slice(i+1).some(b=>hardSessionConflict(a,b,input.policy)));
      const reference=validReference(warmReference)?warmReference:sourceReference;
      const referenceValid=validReference(reference);
      const initial=!!referenceValid||seedFromPreview&&sec.instructorId===inst.id&&sec.state!=='UNASSIGNED'&&!conflictsWithGeneral(input,draft.sessions.filter(s=>s.sectionId===sec.id));
      if(initial){
        const sessions=referenceValid?reference!:draft.sessions.filter(session=>session.sectionId===sec.id);
        initialCandidateId=`${sec.id}:${inst.id}:INITIAL`;
        signatures.add(sessions.map(s=>[s.day,s.start,s.end,s.roomId].join('/')).join('|'));
        choices.push({id:initialCandidateId,sectionId:sec.id,courseCode:course.code,instructorId:inst.id,
          creditedMilli:Math.round(sec.creditedLoad*1000),effectiveLimitMilli:Math.round((inst.maxLoad+(inst.overload?.additionalHours??0))*1000),
          uncovered:false,sessions,...limits(inst,course)});
      }
      if(validReference(sourceReference)){
        const sig=sourceReference!.map(s=>[s.day,s.start,s.end,s.roomId].join('/')).join('|');
        if(!signatures.has(sig)){
          signatures.add(sig);choices.push({id:`${sec.id}:${inst.id}:REFERENCE`,sectionId:sec.id,courseCode:course.code,instructorId:inst.id,
            creditedMilli:Math.round(sec.creditedLoad*1000),effectiveLimitMilli:Math.round((inst.maxLoad+(inst.overload?.additionalHours??0))*1000),
            uncovered:false,sessions:sourceReference!,...limits(inst,course)});
        }
      }
      const reservedChoices=choices.filter(choice=>choice.instructorId===inst.id).length;
      for (let seed = 0; seed < Math.max(0,count-reservedChoices); seed++) {
        const sessions = makeSessions(course, sec, inst, input, seed);
        if (sessions === null||conflictsWithGeneral(input,sessions)) continue;
        const sig = sessions.map(s => [s.day, s.start, s.end, s.roomId].join('/')).join('|');
        if (signatures.has(sig)) continue;
        signatures.add(sig);
        choices.push({
          id: `${sec.id}:${inst.id}:${seed}`,
          sectionId: sec.id, courseCode: course.code, instructorId: inst.id,
          creditedMilli: Math.round(sec.creditedLoad * 1000),
          effectiveLimitMilli: Math.round((inst.maxLoad + (inst.overload?.additionalHours ?? 0)) * 1000),
          uncovered: false, sessions,
          ...limits(inst,course)
        });
      }
    }
    const requiredCoverage=input.scheduleRefinement?.requiredCourseCodes?.includes(course.code);
    if(requiredCoverage){
      choices.splice(0,1);if(!choices.length)throw Error('No candidate for required course section: '+sec.id);
      if(!choices.some(c=>c.id===initialCandidateId))initialCandidateId=choices[0]!.id;
    }
    return {id: sec.id, courseCode: course.code, level: course.level, contactHours: sec.contactHours,
      ...(input.policy.priorityCourseCodes?.includes(course.code)?{priorityCoverage:true}:{}),
      exclusiveInstructor: course.exclusiveInstructor ?? false, choices,...(seedFromPreview?{initialCandidateId}:{})};
  });
  const refinement=input.scheduleRefinement??(input.stableBlockPlan?{seed:20261109,referenceSessions:[],weights:{studentGaps:10,studentDays:100,trainerGaps:1,trainerDays:1,changes:2,roomCount:1,coveragePenalty:1000000}}:undefined);
  return {schemaVersion: 'tps.timefold.v1', tasks, seconds: 5,...(refinement?{seed:refinement.seed,refinement:{
    blockSizes:Object.fromEntries((input.cohortBlocks??[]).map(b=>[b.ref,b.size])),referenceSessions:refinement.referenceSessions,
    weights:refinement.weights,...(input.scheduleRefinement?.requiredCreditedLoads?{requiredCreditedLoads:input.scheduleRefinement.requiredCreditedLoads}:{}),...(input.stableBlockPlan?{maxCampusDays:2}:{}),fixedSessions:[...(input.generalCourseSchedule?.locks??[]),...stableGeneralLocks(input)].map(l=>({
      id:l.id,sectionId:l.externalSectionId,courseCode:l.courseCode,component:'THEORY' as const,mode:l.mode,day:l.day,
      start:l.startMinute/60,end:l.endMinute/60,roomId:l.roomId,instructorId:l.instructorId??'',blockId:null,blockIds:l.blockIds,trainingHours:l.trainingHours}))}}:{})};
}

export function applySolverChoice(input: PlanRequest, payload: SolverPayload, response: SolverResponse): PlanResult {
  if (response.schemaVersion !== payload.schemaVersion || response.choices.length !== payload.tasks.length) throw new Error('Invalid Timefold response size/schema');
  const draft = buildDraftPlan(input);
  const selected = new Map<string, AtomicCandidate>();
  const mapping = new Map(payload.tasks.map(t => [t.id, t]));
  for (const choice of response.choices) {
    if (selected.has(choice.taskId)) throw new Error(`Duplicate solver choice: ${choice.taskId}`);
    const item = mapping.get(choice.taskId)?.choices.find(c => c.id === choice.candidateId);
    if (!item) throw new Error(`Unknown solver candidate: ${choice.taskId}/${choice.candidateId}`);
    selected.set(choice.taskId, item);
  }
  const sessions: Session[] = [];
  const gaps: PlanResult['gaps'] = [];
  const usedLoad = new Map(input.instructors.map(x => [x.id, 0]));
  const courseOwner = new Map<string, string>();
  for (const section of draft.sections) {
    const chosen = selected.get(section.id);
    if (!chosen) throw new Error(`Missing solver choice: ${section.id}`);
    section.instructorId = chosen.instructorId;
    if (chosen.uncovered) {
      if(input.scheduleRefinement?.requiredCourseCodes?.includes(section.courseCode))throw Error('Solver left a required course uncovered');
      section.state = 'UNASSIGNED';
      gaps.push({sectionId: section.id, courseCode: section.courseCode, level: section.level,
        students: section.students, contactHours: section.contactHours, equivalentLoad: section.creditedLoad,
        reason: 'NO_FEASIBLE_TIMETABLE'});
      continue;
    }
    const instructor = input.instructors.find(i => i.id === chosen.instructorId);
    const course = input.courses.find(c => c.code === section.courseCode)!;
    if (!instructor || !eligible(instructor, course)) throw new Error('Solver returned ineligible instructor');
    if(input.scheduleRefinement?.keepInstructors&&input.scheduleRefinement.referenceInstructors[section.id]&&
      input.scheduleRefinement.referenceInstructors[section.id]!==instructor.id)throw new Error('Solver changed retained instructor');
    const owner = courseOwner.get(course.code);
    if (course.exclusiveInstructor && owner && owner !== instructor.id) throw new Error('Solver broke course exclusivity');
    courseOwner.set(course.code, instructor.id);
    if (course.mode === 'SELF_PACED') {
      section.state = 'ASYNC';
      if (chosen.sessions.length) throw new Error('Self-paced has unexpected sessions');
    } else {
      section.state = 'SCHEDULED';
      if (Math.abs(chosen.sessions.reduce((sum,x)=>sum+trainingHours(x,input.policy),0)-section.contactHours)>1e-8) throw new Error('Incorrect assigned contact hours');
    }
    const credited = (usedLoad.get(instructor.id) ?? 0) + chosen.creditedMilli;
    if (credited > Math.round((instructor.maxLoad + (instructor.overload?.additionalHours ?? 0)) * 1000)) throw new Error('Solver exceeded instructor load');
    usedLoad.set(instructor.id, credited);
    sessions.push(...chosen.sessions);
  }
  if(conflictsWithGeneral(input,sessions))throw new Error('Solver overlaps a fixed provisional general-course meeting');
  for(const [id,hours] of Object.entries(input.scheduleRefinement?.requiredCreditedLoads??{}))if(Math.abs((usedLoad.get(id)??0)/1000-hours)>1e-8)throw Error('Solver did not satisfy required instructor load: '+id);
  for (const a of sessions) {
    const instructor = input.instructors.find(i => i.id === a.instructorId)!;
    if ((!input.policy.lecturePeriods&&a.day === 'THU' && a.end > 10) || !available(instructor.available, a.day, a.start, a.end)) throw new Error('Invalid day/availability');
    if(input.policy.lecturePeriods&&a.mode==='ONSITE'&&!validPeriodSession(a,input.policy))throw new Error('Invalid fixed lecture period');
    const c = input.courses.find(x => x.code === a.courseCode)!;
    if (c.mode === 'HYBRID' && (a.mode === 'ONSITE' ? a.end > 12 : a.start < 16 || a.end > 22)) throw new Error('Invalid hybrid time');
    if (a.mode === 'ONSITE') {
      const room = input.rooms.find(r => r.id === a.roomId);
      const studentCount = draft.sections.find(s => s.id === a.sectionId)!.students;
      if (!room || !compatible(room,c,a.component,studentCount,input.policy.ignoreRoomCapacity===true) || !available(room.available, a.day, a.start, a.end)) throw new Error('Invalid room');
    } else if (a.roomId !== null) throw new Error('Remote session has room');
  }
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i]!, b = sessions[j]!;
      if (hardSessionConflict(a,b,input.policy))
        throw new Error(`Timefold returned a collision: ${a.id} and ${b.id}`);
    }
  }
  if (response.hardScore < 0) throw new Error('Solver reports a hard-constraint violation');
  for(const instructor of input.instructors){
    const totals=instructorTotals(instructor.id,draft.sections);
    if(exceedsTeachingLimits(instructor,totals.sections,totals.contact))throw new Error('Solver exceeded instructor timetable/section limit');
  }
  const usedContact = new Map<string, number>();
  for (const s of draft.sections) if (s.state === 'SCHEDULED') usedContact.set(s.instructorId!, (usedContact.get(s.instructorId!) ?? 0) + s.contactHours);
  draft.sessions = sessions;
  draft.gaps = gaps;
  draft.instructorLoads = input.instructors.map(i => {
    const exception = i.overload?.additionalHours ?? 0;
    const credited = (usedLoad.get(i.id) ?? 0) / 1000;
    return {id: i.id, baseLimit: i.maxLoad, approvedException: exception, credited,
      ...(input.policy.lecturePeriods?{clockHours:sessions.filter(session=>session.instructorId===i.id).reduce((sum,s)=>sum+s.end-s.start,0)}:{}),
      contact: usedContact.get(i.id) ?? 0, remaining: round(i.maxLoad + exception - credited)};
  });
  draft.metrics.assignedContactHours = draft.sections.filter(s => s.state === 'SCHEDULED').reduce((v, s) => v + s.contactHours, 0);
  draft.metrics.uncoveredContactHours = draft.metrics.requiredContactHours - draft.metrics.assignedContactHours;
  draft.metrics.uncoveredSectionCount = gaps.length;
  draft.notices = draft.notices.filter(s => !/greedy/i.test(s));
  draft.notices.push('Timefold experimental candidate solver; bounded choices, not guaranteed global optimum; not approved for Rayat.');
  draft.notices.push(`Solver score: hard=${response.hardScore}, soft=${response.softScore}`);
  return draft;
}

/** Explicit invocation only. If Java/JAR is unavailable, fail without pretending the greedy preview was optimized. */
export async function optimizeWithTimefold(input: PlanRequest, opts: {jar?: string; timeoutMs?: number; signal?: AbortSignal; seconds?: number; candidatesPerInstructor?: number; onStage?: (stage:'PREPARING'|'SOLVING'|'VERIFYING')=>Promise<void>|void} = {}): Promise<PlanResult> {
  if (opts.signal?.aborted) throw new Error('Solver cancelled by operator');
  const seconds=opts.seconds??5;
  if (!Number.isInteger(seconds)||seconds<1||seconds>30)
    throw new Error('Solver seconds must be an integer between 1 and 30');
  const candidateCount=opts.candidatesPerInstructor??6;
  if (!Number.isInteger(candidateCount)||candidateCount<1||candidateCount>(input.stableBlockPlan?48:24))
    throw new Error(`Solver candidates per instructor must be between 1 and ${input.stableBlockPlan?48:24}`);
  const jar = resolve(opts.jar ?? process.env.TIMEFOLD_JAR ?? 'solver/target/tps-timefold-0.2.0-jar-with-dependencies.jar');
  await access(jar); // throws ENOENT when not installed
  await opts.onStage?.('PREPARING');
  if (opts.signal?.aborted) throw new Error('Solver cancelled by operator');
  const payload = prepareSolverPayload(input,candidateCount);
  payload.seconds=seconds;
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? Math.max(20000,(seconds+10)*1000), 1000), 60000);
  if(timeoutMs<=seconds*1000)throw new Error('Solver process timeout must exceed requested solve duration');
  await opts.onStage?.('SOLVING');
  if (opts.signal?.aborted) throw new Error('Solver cancelled by operator');
  const stdout = await new Promise<string>((ok, reject) => {
    const child = spawn('java', ['-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-Dstderr.encoding=UTF-8','-jar', jar],
      {stdio: ['pipe', 'pipe', 'pipe'], env: process.env,windowsHide:true});
    const chunks: Buffer[] = [], errorChunks: Buffer[] = [];
    let size = 0, settled = false;
    const timer = setTimeout(() => {child.kill('SIGKILL'); settle(new Error('Solver timed out'));}, timeoutMs);
    function settle(e?: Error, data?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', cancelProcess);
      e ? reject(e) : ok(data ?? '');
    }
    const cancelProcess = () => {child.kill('SIGKILL'); settle(new Error('Solver cancelled by operator'));};
    opts.signal?.addEventListener('abort', cancelProcess, {once:true});
    if (opts.signal?.aborted) cancelProcess();
    child.on('error', (e) => settle(e));
    child.stdout.on('data', b => {size += b.length; if (size > 8_000_000) {child.kill('SIGKILL'); settle(new Error('Solver response too large'));} else chunks.push(b);});
    child.stderr.on('data', b => {if (errorChunks.reduce((s,c) => s + c.length, 0) < 4096) errorChunks.push(b);});
    child.on('close', code => code === 0 ? settle(undefined, Buffer.concat(chunks).toString('utf8')) : settle(new Error(`Solver exited ${code}: ${Buffer.concat(errorChunks).toString('utf8').slice(0,300)}`)));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
  if (opts.signal?.aborted) throw new Error('Solver cancelled by operator');
  await opts.onStage?.('VERIFYING');
  if (opts.signal?.aborted) throw new Error('Solver cancelled by operator');
  const parsed: unknown = JSON.parse(stdout);
  if (!parsed || typeof parsed !== 'object' || !('choices' in parsed) || !Array.isArray(parsed.choices) ||
      !('hardScore' in parsed) || typeof parsed.hardScore !== 'number' || !('softScore' in parsed) || typeof parsed.softScore !== 'number')
    throw new Error('Malformed solver output');
  return applySolverChoice(input, payload, parsed as SolverResponse);
}
