import type {Component, Course, Day, DeliveryMode, Gap, Instructor, PlanRequest, PlanResult, Room, Section, Session, TimeWindow, TimedMode} from './types.js';
import {validateRequest} from './validation.js';
import {trainerQualified,roomQualified} from './eligibility.js';
import {hasSharedBlock} from './cohort-grouping.js';

const round = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const days: Day[] = ['SUN', 'MON', 'TUE', 'WED', 'THU'];
const overlap = (a: {start: number; end: number}, b: {start: number; end: number}) => a.start < b.end && b.start < a.end;
function inAvailability(windows: TimeWindow[] | undefined, day: Day, start: number, end: number): boolean {
  return !windows || windows.some(w => w.day === day && w.from <= start && w.to >= end);
}
function capacity(course: Course, input: PlanRequest): number | null {
  if (course.mode === 'SELF_PACED') return null;
  const cap = input.policy.capacities[course.mode];
  if (course.theoryHours > 0 && course.practicalHours > 0) return Math.min(cap.theory!, cap.practical!);
  return course.theoryHours > 0 ? cap.theory : cap.practical;
}
function load(course: Course, input: PlanRequest): number {
  const p = input.policy;
  if (course.mode === 'SELF_PACED') return p.selfPacedLoadPerOffering!;
  if (course.mode === 'REMOTE') return round(course.theoryHours + course.practicalHours * p.remotePracticalLoadFactor);
  if (course.mode === 'ONSITE') return round(course.theoryHours + course.practicalHours * p.onsitePracticalLoadFactor);
  const split = course.hybridSplit!;
  return round(course.theoryHours + split.practicalOnsiteHours * p.onsitePracticalLoadFactor + split.practicalRemoteHours * p.remotePracticalLoadFactor);
}
function jobs(course: Course): Array<{component: Component; mode: TimedMode; hours: number}> {
  if (course.mode === 'SELF_PACED') return [];
  if (course.mode === 'HYBRID') {
    const h = course.hybridSplit!;
    const hybridJobs: Array<{component: Component; mode: TimedMode; hours: number}> = [
      {component: 'THEORY', mode: 'ONSITE', hours: h.theoryOnsiteHours},
      {component: 'PRACTICAL', mode: 'ONSITE', hours: h.practicalOnsiteHours},
      {component: 'THEORY', mode: 'REMOTE', hours: h.theoryRemoteHours},
      {component: 'PRACTICAL', mode: 'REMOTE', hours: h.practicalRemoteHours}
    ];
    return hybridJobs.filter(s => s.hours > 0);
  }
  return [
    {component: 'THEORY' as const, mode: course.mode, hours: course.theoryHours},
    {component: 'PRACTICAL' as const, mode: course.mode, hours: course.practicalHours}
  ].filter(s => s.hours > 0);
}
function canTeach(i: Instructor, c: Course): boolean {return trainerQualified(i,c);}
function effectiveLimit(i: Instructor): number { return i.maxLoad + (i.overload?.additionalHours ?? 0); }
function findSchedule(
  s: Section, c: Course, instructor: Instructor, allSessions: Session[], rooms: Room[], input: PlanRequest
): Session[] | null {
  const proposed: Session[] = [];
  let serial = 1;
  const all = () => [...allSessions, ...proposed];
  for (const job of jobs(c)) {
    let remaining = job.hours;
    while (remaining > 0) {
      // Split 3 hours as 2 + 1, rather than reserving one artificially long continuous block.
      let placed = false;
      for (const duration of [...new Set([Math.min(remaining, input.policy.sessionMaxHours), Math.min(remaining, 1), 0.5])]) {
        if (placed) break;
        for (const day of days) {
          if (placed) break;
          for (const w of input.policy.slots.filter(w => w.day === day)) {
            if (placed) break;
            for (let start = w.from; start + duration <= w.to; start += 0.5) {
              const end = start + duration;
              if (day === 'THU' && end > 10) continue;
              if (c.mode === 'HYBRID' && job.mode === 'ONSITE' && end > 12) continue;
              if (c.mode === 'HYBRID' && job.mode === 'REMOTE' && (start < 16 || end > 22)) continue;
              if (!inAvailability(instructor.available, day, start, end)) continue;
              if (all().some(existing => existing.day === day && overlap({start, end}, existing) &&
                (existing.instructorId === instructor.id ||
                 hasSharedBlock(existing,s) ||
                 existing.sectionId === s.id))) continue;
              const eligibleRooms = job.mode === 'REMOTE' ? [null] : rooms.filter(r =>
                roomQualified(r,c,job.component,s.students) &&
                inAvailability(r.available, day, start, end) &&
                !all().some(x => x.roomId === r.id && x.day === day && overlap({start, end}, x))
              );
              if (eligibleRooms.length === 0) continue;
              const room = eligibleRooms[0];
              proposed.push({
                id: `${s.id}-${String(serial++).padStart(2, '0')}`, sectionId: s.id, courseCode: c.code,
                component: job.component, mode: job.mode, day, start, end,
                roomId: room?.id ?? null, instructorId: instructor.id, blockId: s.blockId,
                ...(s.blockIds?{blockIds:s.blockIds}:{})
              });
              remaining -= duration;
              placed = true;
              break;
            }
            if (placed) break;
          }
        }
      }
      if (!placed) return null; // Entire section will remain uncovered; no partial timetable is committed.
    }
  }
  return proposed;
}

/** Deterministic *draft* baseline: a greedy feasibility planner, not the future Timefold optimizer. */
export function buildDraftPlan(input: PlanRequest): PlanResult {
  validateRequest(input);
  const sections: Section[] = [];
  const sessions: Session[] = [];
  const gaps: Gap[] = [];
  const notices: string[] = [];
  const instructorLoads = new Map(input.instructors.map(i => [i.id, {credited: 0, contact: 0}]));
  const required: Array<{s: Section; course: Course}> = [];
  // Locked assignments first; deterministic input order is retained within each class.
  const courses = [...input.courses].sort((a, b) => Number(!!b.assignedInstructorId) - Number(!!a.assignedInstructorId));
  for (const c of courses) {
    if (c.demand === 0) continue;
    const cap = capacity(c, input);
    const count = c.blockSizes?.length ?? (cap === null ? 1 : Math.ceil(c.demand / cap));
    for (let n = 0; n < count; n++) {
      const students = c.blockSizes?.[n] ?? (cap === null ? c.demand : Math.min(cap, c.demand - n * cap));
      const sec: Section = {
        id: `${c.code}-${String(n + 1).padStart(3, '0')}`,
        courseCode: c.code, level: c.level, index: n + 1, mode: c.mode,
        students, capacity: cap, blockId: c.blocks?.[n] ?? null,
        ...(c.blockGroups?.[n]?.length?{blockIds:c.blockGroups[n]}:{}),
        paired: c.theoryHours > 0 && c.practicalHours > 0,
        instructorId: null,
        contactHours: c.mode === 'SELF_PACED' ? 0 : c.theoryHours + c.practicalHours,
        creditedLoad: load(c, input), state: 'UNASSIGNED'
      };
      sections.push(sec);
      required.push({s: sec, course: c});
    }
  }
  const courseOwner = new Map<string, string>();
  for (const {s, course: c} of required) {
    const allowed = input.instructors.filter(i => canTeach(i, c) &&
      (!c.exclusiveInstructor || !courseOwner.has(c.code) || courseOwner.get(c.code) === i.id));
    const ranked = allowed.sort((a, b) => {
      // Preserve a fixed course owner. Otherwise prioritize more remaining weighted capacity.
      const ra = effectiveLimit(a) - (instructorLoads.get(a.id)?.credited ?? 0);
      const rb = effectiveLimit(b) - (instructorLoads.get(b.id)?.credited ?? 0);
      return rb - ra || a.id.localeCompare(b.id);
    });
    let reason: Gap['reason'] = ranked.length === 0 ? 'NO_ELIGIBLE_INSTRUCTOR' : 'LOAD_LIMIT';
    let committed = false;
    for (const inst of ranked) {
      const state = instructorLoads.get(inst.id)!;
      if (state.credited + s.creditedLoad > effectiveLimit(inst) + 1e-8) continue;
      if (c.mode === 'SELF_PACED') {
        s.instructorId = inst.id;
        s.state = 'ASYNC';
        state.credited = round(state.credited + s.creditedLoad);
        courseOwner.set(c.code, inst.id);
        committed = true;
        break;
      }
      const proposed = findSchedule(s, c, inst, sessions, input.rooms, input);
      if (!proposed) {reason = 'NO_FEASIBLE_TIMETABLE'; continue;}
      sessions.push(...proposed);
      s.instructorId = inst.id;
      s.state = 'SCHEDULED';
      state.credited = round(state.credited + s.creditedLoad);
      state.contact += s.contactHours;
      courseOwner.set(c.code, inst.id);
      committed = true;
      break;
    }
    if (!committed) {
      gaps.push({sectionId: s.id, courseCode: c.code, level: c.level, students: s.students,
        contactHours: s.contactHours, equivalentLoad: s.creditedLoad, reason});
    }
  }
  if (required.some(({s}) => s.blockId === null && s.state === 'SCHEDULED')) {
    notices.push('Student-block overlaps cannot be fully validated: some sections have no block ID.');
  }
  if (input.courses.some(c => c.mode !== 'ONSITE')) {
    notices.push('Optional training modes are local planning assumptions; confirm course eligibility and regulatory approval before publication.');
  }
  notices.push('Deterministic greedy draft; no optimality guarantee. No automatic publication to Rayat.');
  const requiredHours = sections.reduce((sum, x) => sum + x.contactHours, 0);
  const assignedHours = sections.filter(s => s.state === 'SCHEDULED').reduce((sum, x) => sum + x.contactHours, 0);
  return {
    status: 'DRAFT', scenarioName: input.scenarioName, termId: input.termId, sections, sessions, gaps,
    instructorLoads: input.instructors.map(i => {
      const state = instructorLoads.get(i.id)!;
      const exception = i.overload?.additionalHours ?? 0;
      return {id: i.id, baseLimit: i.maxLoad, approvedException: exception,
        credited: round(state.credited), contact: state.contact,
        remaining: round(i.maxLoad + exception - state.credited)};
    }),
    metrics: {requiredContactHours: requiredHours, assignedContactHours: assignedHours,
      uncoveredContactHours: requiredHours - assignedHours, sectionCount: sections.length,
      uncoveredSectionCount: gaps.length}, notices
  };
}
