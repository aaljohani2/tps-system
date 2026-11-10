import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDraftPlan} from '../src/planner.js';
import {defaultPolicy} from '../src/policy.js';
import type {Course, Instructor, PlanRequest, Room} from '../src/types.js';
const classRoom = (capacity: number): Room => ({id: `C${capacity}`, name: 'Class', type: 'CLASSROOM', capacity});
const lab = (capacity: number): Room => ({id: `L${capacity}`, name: 'Lab', type: 'LAB', capacity});
const inst = (modes: Instructor['allowedModes'], load = 200): Instructor => ({id: 'T01', name: 'Trainer', maxLoad: load, allowedModes: modes});
const course = (mode: Course['mode'], demand = 180, theory = 2, practical = 0): Course => ({
  code: 'ADM-101', title: 'Sample', level: 1, demand, theoryHours: theory, practicalHours: practical,
  mode, eligibleModes: ['ONSITE', mode]
});
const fixture = (c: Course, teacher = inst(['ONSITE']), rooms: Room[] = [classRoom(45), lab(45)]): PlanRequest => ({
  scenarioName: 'اختبار', termId: '144720', courses: [c], instructors: [teacher], rooms, policy: defaultPolicy()
});
function activate(request: PlanRequest, mode: Course['mode']): void {
  request.policy.enabledModes = ['ONSITE', mode];
}

test('layer 1: onsite theoretical 180 / 45 = 4 sections', () => {
  const r = buildDraftPlan(fixture(course('ONSITE')));
  assert.equal(r.sections.length, 4);
  assert.deepEqual(r.sections.map(x => x.students), [45, 45, 45, 45]);
  assert.equal(r.metrics.uncoveredContactHours, 0);
});
test('layer 1: onsite practical 180 / 30 = 6 sections', () => {
  const r = buildDraftPlan(fixture(course('ONSITE', 180, 0, 2), inst(['ONSITE']), [lab(30)]));
  assert.equal(r.sections.length, 6);
  assert.equal(r.metrics.uncoveredContactHours, 0);
});
test('layer 1: paired theory/practical produces six paired units not ten independent sections', () => {
  const r = buildDraftPlan(fixture(course('ONSITE', 180, 2, 2), inst(['ONSITE']), [classRoom(45), lab(30)]));
  assert.equal(r.sections.length, 6);
  assert.ok(r.sections.every(s => s.paired && s.students === 30));
  assert.equal(r.sessions.filter(x => x.component === 'PRACTICAL').length, 6);
});
test('disabled optional mode is rejected', () => {
  assert.throws(() => buildDraftPlan(fixture(course('REMOTE'))), /disabled/);
});
test('layer 2: remote 180 / 120 = 2 no physical rooms', () => {
  const f = fixture(course('REMOTE'), inst(['REMOTE']), []);
  activate(f, 'REMOTE');
  const r = buildDraftPlan(f);
  assert.equal(r.sections.length, 2);
  assert.deepEqual(r.sections.map(x => x.students), [120, 60]);
  assert.ok(r.sessions.every(s => s.roomId === null));
});
test('layer 2: paired remote uses 120 capacity with 1-to-1 groups; practical load factor 2/3', () => {
  const f = fixture(course('REMOTE', 180, 2, 3), inst(['REMOTE']), []);
  activate(f, 'REMOTE');
  const r = buildDraftPlan(f);
  assert.equal(r.sections.length, 2);
  assert.ok(r.sections.every(s => s.paired && s.creditedLoad === 4));
  assert.equal(r.instructorLoads[0]?.credited, 8);
  assert.equal(r.instructorLoads[0]?.contact, 10);
});
test('layer 3: self-paced unlimited capacity, asynchronous without time/room, explicit load policy', () => {
  const f = fixture(course('SELF_PACED', 1800), inst(['SELF_PACED']), []);
  activate(f, 'SELF_PACED');
  f.policy.selfPacedLoadPerOffering = 3;
  const r = buildDraftPlan(f);
  assert.equal(r.sections.length, 1);
  assert.equal(r.sections[0]?.students, 1800);
  assert.equal(r.sections[0]?.capacity, null);
  assert.equal(r.sections[0]?.state, 'ASYNC');
  assert.equal(r.sessions.length, 0);
  assert.equal(r.instructorLoads[0]?.credited, 3);
});
test('layer 3: self-paced without defined load policy cannot be silently assigned', () => {
  const f = fixture(course('SELF_PACED', 200), inst(['SELF_PACED']), []);
  activate(f, 'SELF_PACED');
  assert.throws(() => buildDraftPlan(f), /needs an approved load policy/);
});
test('layer 4: hybrid demand 180 -> 4 paired units; morning onsite, 16-22 remote', () => {
  const c = course('HYBRID', 180, 2, 2);
  c.hybridSplit = {theoryOnsiteHours: 1, theoryRemoteHours: 1, practicalOnsiteHours: 1, practicalRemoteHours: 1};
  const f = fixture(c, inst(['ONSITE','REMOTE','HYBRID']), [classRoom(45), lab(45)]);
  activate(f, 'HYBRID');
  const r = buildDraftPlan(f);
  assert.equal(r.sections.length, 4);
  assert.ok(r.sections.every(s => s.paired && s.capacity === 45));
  assert.ok(r.sessions.some(s => s.mode === 'ONSITE'));
  assert.ok(r.sessions.some(s => s.mode === 'REMOTE'));
  assert.ok(r.sessions.filter(s => s.mode === 'ONSITE').every(s => s.end <= 12));
  assert.ok(r.sessions.filter(s => s.mode === 'REMOTE').every(s => s.start >= 16 && s.end <= 22));
});
test('hard Thursday rule rejects invalid timetable window', () => {
  const f = fixture(course('ONSITE'));
  f.policy.slots = [{day:'THU', from:9, to:11}];
  assert.throws(() => buildDraftPlan(f), /Thursday after 10/);
});
test('missing physical rooms reports full uncovered demand rather than inventing a schedule', () => {
  const r = buildDraftPlan(fixture(course('ONSITE', 45, 3), inst(['ONSITE']), []));
  assert.equal(r.metrics.uncoveredContactHours, 3);
  assert.equal(r.metrics.uncoveredSectionCount, 1);
  assert.equal(r.sections[0]?.instructorId, null);
  assert.equal(r.sessions.length, 0);
});
test('approved overload is visible; without it no overage is assigned', () => {
  const c = course('ONSITE', 45, 3);
  c.assignedInstructorId = 'T01';
  const f = fixture(c, inst(['ONSITE'], 2));
  assert.equal(buildDraftPlan(f).metrics.uncoveredContactHours, 3);
  f.instructors[0]!.overload = {additionalHours: 1, reason: 'Approved economics exception'};
  const r = buildDraftPlan(f);
  assert.equal(r.metrics.uncoveredContactHours, 0);
  assert.equal(r.instructorLoads[0]?.baseLimit, 2);
  assert.equal(r.instructorLoads[0]?.approvedException, 1);
});
test('exclusive course assignment does not split same course among different instructors', () => {
  const c = course('ONSITE', 90, 2);
  c.exclusiveInstructor = true;
  const f = fixture(c, inst(['ONSITE'], 2));
  f.instructors.push({...inst(['ONSITE'], 2), id:'T02'});
  const r = buildDraftPlan(f);
  assert.equal(r.sections.filter(s => s.state === 'SCHEDULED').length, 1);
  assert.equal(r.metrics.uncoveredContactHours, 2);
});
test('block ID prevents collision of sessions for same cohort', () => {
  const c = course('ONSITE', 45, 2);
  c.blocks = ['LEVEL1-A'];
  const c2 = {...course('ONSITE', 45, 2), code: 'ADM-102', blocks:['LEVEL1-A']};
  const f = fixture(c);
  f.courses.push(c2);
  f.instructors.push({...inst(['ONSITE'], 200), id:'T02'});
  const r = buildDraftPlan(f);
  for (let i = 0; i < r.sessions.length; i++) {
    for (let j = i + 1; j < r.sessions.length; j++) {
      const a = r.sessions[i]!;
      const b = r.sessions[j]!;
      if (a.day === b.day && a.blockId === b.blockId) assert.ok(a.end <= b.start || b.end <= a.start);
    }
  }
});
test('on-site-only instructor is not eligible for remote even if enabled for course', () => {
  const f = fixture(course('REMOTE'), inst(['ONSITE']), []);
  activate(f, 'REMOTE');
  const r = buildDraftPlan(f);
  assert.equal(r.gaps[0]?.reason, 'NO_ELIGIBLE_INSTRUCTOR');
});
