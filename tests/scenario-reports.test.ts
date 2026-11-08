import test from 'node:test';
import assert from 'node:assert/strict';
import type {PlanRequest} from '../src/types.js';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {buildScenarioReport,type ReportMetadata} from '../src/scenario-reports.js';
const metadata:ReportMetadata={scenarioId:'SYNTHETIC',scenarioName:'Synthetic report',state:'DRAFT',solverStatus:'COMPLETED',revision:3,policyRevision:2,
 collegeName:'Synthetic college',departmentName:'Synthetic department',termCode:'T',termLabel:'Synthetic term',generatedAt:'2026-11-08 12:00'};
function fixture():PlanRequest{
 const memberships=[['G::A','G::A2','G::B'],['G::C']],second=[['G::A','G::A2'],['G::B','G::C']];
 return {scenarioName:'Saved membership report',termId:'T',policy:defaultPolicy(),
  cohortBlocks:[{ref:'G::A',level:1,size:5},{ref:'G::A2',level:1,size:5},{ref:'G::B',level:1,size:10},{ref:'G::C',level:1,size:20}],
  courses:[{code:'X',title:'First internal course',level:1,demand:40,theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],
   blocks:memberships.map(m=>m.join(' + ')),blockGroups:memberships,blockSizes:[20,20]},
   {code:'Y',title:'Second internal course',level:1,demand:40,theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],
    blocks:second.map(m=>m.join(' + ')),blockGroups:second,blockSizes:[10,30]},
   {code:'EXT',title:'External general course',level:1,demand:40,theoryHours:2,practicalHours:0,mode:'ONSITE',eligibleModes:['ONSITE'],
    assignmentScope:'EXTERNAL',externalSectionCapacity:40,blocks:second.map(m=>m.join(' + ')),blockGroups:second,blockSizes:[10,30]}],
  instructors:[{id:'T1',name:'Trainer one',maxLoad:24,allowedModes:['ONSITE']}],rooms:[{id:'R1',name:'Classroom',type:'CLASSROOM',capacity:50},{id:'R2',name:'Unused facility',type:null,capacity:null}]};
}
test('trainee report consolidates only identical verified course memberships without mixing a whole level',()=>{
 const input=fixture(),result=buildDraftPlan(input),report=buildScenarioReport(input,result,metadata,'trainees',[]);
 assert.equal(report.entities.length,3);assert.equal(report.summary.studentCount,40);
 const merged=report.entities.find(entity=>entity.members?.includes('G::A'))!;
 assert.deepEqual(merged.members,['G::A','G::A2']);assert.equal(merged.students,10);
 assert.ok(merged.meetings.some(meeting=>meeting.sectionId==='X-001'));
 assert.ok(merged.meetings.some(meeting=>meeting.sectionId==='Y-001'));
 assert.ok(!merged.meetings.some(meeting=>meeting.sectionId==='Y-002'));
 assert.deepEqual(merged.pending.map(p=>p.sectionId),['EXT-EXT-001']);
 for(const entity of report.entities)for(const meeting of entity.meetings){
  const section=result.sections.find(section=>section.id===meeting.sectionId)!;
  assert.ok(entity.members!.every(member=>section.blockIds!.includes(member)));
 }
});
test('instructor and room reports preserve saved sessions, names, exact minutes and unused resources without mutation',()=>{
 const input=fixture(),result=buildDraftPlan(input),before=structuredClone({input,result});
 for(const kind of ['instructors','rooms'] as const){
  const report=buildScenarioReport(input,result,metadata,kind,[]);
  assert.deepEqual(report.entities.flatMap(entity=>entity.meetings.map(meeting=>meeting.id)).sort(),result.sessions.map(session=>session.id).sort());
  assert.ok(report.entities.flatMap(entity=>entity.meetings).every(meeting=>meeting.title&&meeting.instructor==='Trainer one (T1)'));
  assert.equal(report.summary.externalSections,2);
 }
 const rooms=buildScenarioReport(input,result,metadata,'rooms',[]);
 assert.equal(rooms.entities.find(entity=>entity.id==='R2')!.meetings.length,0);
 assert.ok(rooms.entities.find(entity=>entity.id==='R2')!.notes[0]!.includes('غير مصنف'));
 assert.deepEqual({input,result},before);
});
test('missing cohort evidence never produces an invented trainee timetable from level alone',()=>{
 const input=fixture(),result=buildDraftPlan(input);delete input.cohortBlocks;
 const report=buildScenarioReport(input,result,metadata,'trainees',[]);
 assert.equal(report.entities.length,0);assert.equal(report.summary.studentCount,null);
 assert.ok(report.notes.some(note=>note.includes('لا يمكن استخراج')));
});
