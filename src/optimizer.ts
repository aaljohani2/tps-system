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
}
export interface AtomicTask {
  id: string;
  courseCode: string;
  level: number;
  contactHours: number;
  exclusiveInstructor: boolean;
  choices: AtomicCandidate[];
}
export interface SolverPayload {schemaVersion: 'tps.timefold.v1'; tasks: AtomicTask[]; seconds: number}
export interface SolverChoice {taskId: string; candidateId: string}
export interface SolverResponse {schemaVersion: 'tps.timefold.v1'; choices: SolverChoice[]; hardScore: number; softScore: number}

function eligible(inst: Instructor, c: Course): boolean {
  if (!inst.allowedModes.includes(c.mode)) return false;
  if (c.mode === 'HYBRID' && (!inst.allowedModes.includes('ONSITE') || !inst.allowedModes.includes('REMOTE'))) return false;
  if (inst.eligibleCourseCodes && !inst.eligibleCourseCodes.includes(c.code)) return false;
  if (inst.exclusiveCourseCodes && !inst.exclusiveCourseCodes.includes(c.code)) return false;
  if (c.assignedInstructorId && inst.id !== c.assignedInstructorId) return false;
  return true;
}
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
function compatible(room: Room, component: Component, students: number): boolean {
  return room.capacity >= students && (room.type === 'MULTI' || (component === 'THEORY' ? room.type === 'CLASSROOM' : room.type === 'LAB'));
}
/** Alternative atomic schedules for one trainer; never share the section with another trainer. */
function makeSessions(c: Course, sec: Section, inst: Instructor, input: PlanRequest, seed: number): Session[] | null {
  const allocated: Session[] = [];
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
              const rooms = job.mode === 'REMOTE' ? [null] : input.rooms.filter(r => compatible(r, job.component, sec.students) && available(r.available, day, start, end));
              if (!rooms.length) continue;
              const chosen = rooms[seed % rooms.length];
              allocated.push({
                id: `${sec.id}-P${seed + 1}-${allocated.length + 1}`, sectionId: sec.id,
                courseCode: c.code, component: job.component, mode: job.mode,
                day, start, end, roomId: chosen?.id ?? null, instructorId: inst.id,
                blockId: sec.blockId
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
  if (!Number.isInteger(maxChoicesPerInstructor) || maxChoicesPerInstructor < 1 || maxChoicesPerInstructor > 24) throw new Error('Invalid candidate limit');
  const draft = buildDraftPlan(input); // validates course/policy/instructor/room schema.
  if (draft.sections.length > 250) throw new Error('Experimental optimizer supports at most 250 sections per scenario.');
  const courses = new Map(input.courses.map(c => [c.code, c]));
  const tasks: AtomicTask[] = draft.sections.map(sec => {
    const course = courses.get(sec.courseCode)!;
    const choices: AtomicCandidate[] = [{
      id: `${sec.id}:UNCOVERED`, sectionId: sec.id, courseCode: course.code,
      instructorId: null, creditedMilli: 0, effectiveLimitMilli: 0,
      uncovered: true, sessions: []
    }];
    for (const inst of input.instructors.filter(i => eligible(i, course))) {
      const count = course.mode === 'SELF_PACED' ? 1 : maxChoicesPerInstructor;
      const signatures = new Set<string>();
      for (let seed = 0; seed < count; seed++) {
        const sessions = makeSessions(course, sec, inst, input, seed);
        if (sessions === null) continue;
        const sig = sessions.map(s => [s.day, s.start, s.end, s.roomId].join('/')).join('|');
        if (signatures.has(sig)) continue;
        signatures.add(sig);
        choices.push({
          id: `${sec.id}:${inst.id}:${seed}`,
          sectionId: sec.id, courseCode: course.code, instructorId: inst.id,
          creditedMilli: Math.round(sec.creditedLoad * 1000),
          effectiveLimitMilli: Math.round((inst.maxLoad + (inst.overload?.additionalHours ?? 0)) * 1000),
          uncovered: false, sessions
        });
      }
    }
    return {id: sec.id, courseCode: course.code, level: course.level, contactHours: sec.contactHours,
      exclusiveInstructor: course.exclusiveInstructor ?? false, choices};
  });
  return {schemaVersion: 'tps.timefold.v1', tasks, seconds: 5};
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
      section.state = 'UNASSIGNED';
      gaps.push({sectionId: section.id, courseCode: section.courseCode, level: section.level,
        students: section.students, contactHours: section.contactHours, equivalentLoad: section.creditedLoad,
        reason: 'NO_FEASIBLE_TIMETABLE'});
      continue;
    }
    const instructor = input.instructors.find(i => i.id === chosen.instructorId);
    const course = input.courses.find(c => c.code === section.courseCode)!;
    if (!instructor || !eligible(instructor, course)) throw new Error('Solver returned ineligible instructor');
    const owner = courseOwner.get(course.code);
    if (course.exclusiveInstructor && owner && owner !== instructor.id) throw new Error('Solver broke course exclusivity');
    courseOwner.set(course.code, instructor.id);
    if (course.mode === 'SELF_PACED') {
      section.state = 'ASYNC';
      if (chosen.sessions.length) throw new Error('Self-paced has unexpected sessions');
    } else {
      section.state = 'SCHEDULED';
      if (chosen.sessions.reduce((sum, x) => sum + x.end - x.start, 0) !== section.contactHours) throw new Error('Incorrect assigned contact hours');
    }
    const credited = (usedLoad.get(instructor.id) ?? 0) + chosen.creditedMilli;
    if (credited > Math.round((instructor.maxLoad + (instructor.overload?.additionalHours ?? 0)) * 1000)) throw new Error('Solver exceeded instructor load');
    usedLoad.set(instructor.id, credited);
    sessions.push(...chosen.sessions);
  }
  for (const a of sessions) {
    const instructor = input.instructors.find(i => i.id === a.instructorId)!;
    if (a.day === 'THU' && a.end > 10 || !available(instructor.available, a.day, a.start, a.end)) throw new Error('Invalid day/availability');
    const c = input.courses.find(x => x.code === a.courseCode)!;
    if (c.mode === 'HYBRID' && (a.mode === 'ONSITE' ? a.end > 12 : a.start < 16 || a.end > 22)) throw new Error('Invalid hybrid time');
    if (a.mode === 'ONSITE') {
      const room = input.rooms.find(r => r.id === a.roomId);
      const studentCount = draft.sections.find(s => s.id === a.sectionId)!.students;
      if (!room || !compatible(room, a.component, studentCount) || !available(room.available, a.day, a.start, a.end)) throw new Error('Invalid room');
    } else if (a.roomId !== null) throw new Error('Remote session has room');
  }
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i]!, b = sessions[j]!;
      if (a.day === b.day && collide(a, b) &&
          (a.instructorId === b.instructorId || (a.blockId !== null && a.blockId === b.blockId) ||
           (a.roomId !== null && a.roomId === b.roomId) || a.sectionId === b.sectionId))
        throw new Error(`Timefold returned a collision: ${a.id} and ${b.id}`);
    }
  }
  if (response.hardScore < 0) throw new Error('Solver reports a hard-constraint violation');
  const usedContact = new Map<string, number>();
  for (const s of draft.sections) if (s.state === 'SCHEDULED') usedContact.set(s.instructorId!, (usedContact.get(s.instructorId!) ?? 0) + s.contactHours);
  draft.sessions = sessions;
  draft.gaps = gaps;
  draft.instructorLoads = input.instructors.map(i => {
    const exception = i.overload?.additionalHours ?? 0;
    const credited = (usedLoad.get(i.id) ?? 0) / 1000;
    return {id: i.id, baseLimit: i.maxLoad, approvedException: exception, credited,
      contact: usedContact.get(i.id) ?? 0, remaining: round(i.maxLoad + exception - credited)};
  });
  draft.metrics.assignedContactHours = draft.sections.filter(s => s.state === 'SCHEDULED').reduce((v, s) => v + s.contactHours, 0);
  draft.metrics.uncoveredContactHours = draft.metrics.requiredContactHours - draft.metrics.assignedContactHours;
  draft.metrics.uncoveredSectionCount = gaps.length;
  draft.notices = draft.notices.filter(s => !s.includes('Greedy'));
  draft.notices.push('Timefold experimental candidate solver; bounded choices, not guaranteed global optimum; not approved for Rayat.');
  draft.notices.push(`Solver score: hard=${response.hardScore}, soft=${response.softScore}`);
  return draft;
}

/** Explicit invocation only. If Java/JAR is unavailable, fail without pretending the greedy preview was optimized. */
export async function optimizeWithTimefold(input: PlanRequest, opts: {jar?: string; timeoutMs?: number; signal?: AbortSignal} = {}): Promise<PlanResult> {
  if (opts.signal?.aborted) throw new Error('Solver cancelled by operator');
  const jar = resolve(opts.jar ?? process.env.TIMEFOLD_JAR ?? 'solver/target/tps-timefold-0.2.0-jar-with-dependencies.jar');
  await access(jar); // throws ENOENT when not installed
  const payload = prepareSolverPayload(input);
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 20000, 1000), 60000);
  const stdout = await new Promise<string>((ok, reject) => {
    const child = spawn('java', ['-jar', jar], {stdio: ['pipe', 'pipe', 'pipe'], env: process.env});
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
  const parsed: unknown = JSON.parse(stdout);
  if (!parsed || typeof parsed !== 'object' || !('choices' in parsed) || !Array.isArray(parsed.choices) ||
      !('hardScore' in parsed) || typeof parsed.hardScore !== 'number' || !('softScore' in parsed) || typeof parsed.softScore !== 'number')
    throw new Error('Malformed solver output');
  return applySolverChoice(input, payload, parsed as SolverResponse);
}
