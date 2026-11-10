import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {prepareSolverPayload,applySolverChoice} from '../src/optimizer.js';
import {assessReadiness} from '../src/api/readiness.js';
import {moveScheduledSession} from '../src/manual-schedule.js';
import {validateRequest} from '../src/validation.js';
import type {PlanRequest} from '../src/types.js';

function fixture():PlanRequest{
  return {scenarioName:'Qualification and equipment integration test',termId:'TEST-TERM',
    policy:defaultPolicy(),courses:[{
      code:'ERP-101',title:'ERP Lab',level:1,demand:20,theoryHours:2,practicalHours:0,
      mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['COHORT::A'],
      requiredSpecialties:['ERP'],requiredEquipment:['PC']
    }],
    instructors:[
      {id:'UNQUALIFIED',name:'Missing specialty',maxLoad:18,allowedModes:['ONSITE'],specialties:['ACCOUNTING']},
      {id:'QUALIFIED',name:'ERP specialist',maxLoad:18,allowedModes:['ONSITE'],specialties:['ERP']}
    ],
    rooms:[
      {id:'NO-PC',name:'Standard classroom',type:'CLASSROOM',capacity:30,equipmentCodes:[]},
      {id:'WITH-PC',name:'Equipped classroom',type:'CLASSROOM',capacity:30,equipmentCodes:['PC']}
    ]};
}
test('greedy and Timefold generate only qualified trainer/room placements',()=>{
  const input=fixture(),draft=buildDraftPlan(input),payload=prepareSolverPayload(input,6);
  assert.equal(draft.metrics.uncoveredSectionCount,0);
  assert.equal(draft.sections[0]?.instructorId,'QUALIFIED');
  assert.ok(draft.sessions.every(s=>s.roomId==='WITH-PC'));
  const valid=payload.tasks[0]!.choices.filter(c=>!c.uncovered);
  assert.ok(valid.length>0);
  assert.ok(valid.every(c=>c.instructorId==='QUALIFIED'&&c.sessions.every(s=>s.roomId==='WITH-PC')));
  const result=applySolverChoice(input,payload,{
    schemaVersion:payload.schemaVersion,
    choices:payload.tasks.map(t=>({taskId:t.id,candidateId:t.choices.find(c=>!c.uncovered)!.id})),
    hardScore:0,softScore:0
  });
  assert.equal(assessReadiness(input,result,'COMPLETED').technicalReady,true);
});
test('insufficient specialty or physical equipment becomes explicit uncovered work',()=>{
  const noSpecialist=fixture();noSpecialist.instructors=noSpecialist.instructors.slice(0,1);
  const noSkillDraft=buildDraftPlan(noSpecialist);
  assert.equal(noSkillDraft.gaps[0]?.reason,'NO_ELIGIBLE_INSTRUCTOR');
  assert.ok(prepareSolverPayload(noSpecialist).tasks[0]!.choices.every(c=>c.uncovered));
  const noEquipment=fixture();noEquipment.rooms=noEquipment.rooms.slice(0,1);
  const noRoomDraft=buildDraftPlan(noEquipment);
  assert.equal(noRoomDraft.gaps[0]?.reason,'NO_FEASIBLE_TIMETABLE');
  assert.ok(prepareSolverPayload(noEquipment).tasks[0]!.choices.every(c=>c.uncovered));
});
test('manual edits and readiness refuse unqualified resource substitutions',()=>{
  const input=fixture(),result=buildDraftPlan(input),session=result.sessions[0]!;
  assert.throws(()=>moveScheduledSession(input,result,{
    sessionId:session.id,day:session.day,start:session.start,roomId:'WITH-PC',instructorId:'UNQUALIFIED'
  }),/qualification/);
  assert.throws(()=>moveScheduledSession(input,result,{
    sessionId:session.id,day:session.day,start:session.start,roomId:'NO-PC',instructorId:'QUALIFIED'
  }),/Room capacity or component compatibility/);
  const forged=structuredClone(result);
  forged.sessions[0]!.roomId='NO-PC';
  assert.ok(assessReadiness(input,forged,'COMPLETED').issues.some(x=>x.code==='ROOM_INCOMPATIBLE'));
  const forgedTrainer=structuredClone(result);
  forgedTrainer.sessions[0]!.instructorId='UNQUALIFIED';
  assert.ok(assessReadiness(input,forgedTrainer,'COMPLETED').issues.some(x=>x.code==='INELIGIBLE_INSTRUCTOR'));
});
test('requirement identifiers reject duplicates and untrusted strings',()=>{
  const input=fixture();input.courses[0]!.requiredEquipment=['PC','PC'];
  assert.throws(()=>validateRequest(input),/Invalid specialty or equipment/);
  input.courses[0]!.requiredEquipment=['=DANGEROUS'];
  assert.throws(()=>validateRequest(input),/Invalid specialty or equipment/);
});
