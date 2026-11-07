import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {defaultPolicy} from '../src/policy.js';
import {buildDraftPlan} from '../src/planner.js';
import {prepareSolverPayload,optimizeWithTimefold} from '../src/optimizer.js';
import {assessReadiness} from '../src/api/readiness.js';
import {moveScheduledSession} from '../src/manual-schedule.js';
import {roomTypeFromDescription} from '../src/raiyat-resources.js';
import type {PlanRequest} from '../src/types.js';

const fixture=():PlanRequest=>({scenarioName:'Explicit ignored room capacity',termId:'TEST',policy:defaultPolicy(),
 courses:[{code:'COURSE',title:'Theory',level:1,demand:20,theoryHours:2,practicalHours:0,
  mode:'ONSITE',eligibleModes:['ONSITE'],blocks:['L1::A'],blockSizes:[20]}],
 instructors:[{id:'I',name:'Synthetic instructor',maxLoad:20,allowedModes:['ONSITE']}],
 rooms:[{id:'R',name:'Source classroom',type:'CLASSROOM',capacity:null}]});

test('unknown room capacity blocks normal scheduling but explicit local option permits it without fabrication',()=>{
 const input=fixture();assert.equal(buildDraftPlan(input).gaps.length,1);
 input.policy.ignoreRoomCapacity=true;const result=buildDraftPlan(input);
 assert.equal(result.gaps.length,0);assert.equal(input.rooms[0]!.capacity,null);
 const readiness=assessReadiness(input,result,'COMPLETED');
 assert.equal(readiness.technicalReady,true);
 assert.ok(readiness.issues.some(issue=>issue.code==='ROOM_CAPACITY_IGNORED'&&issue.severity==='WARNING'));
 input.policy.ignoreRoomCapacity=false;
 assert.ok(assessReadiness(input,result,'COMPLETED').issues.some(issue=>issue.code==='ROOM_CAPACITY'));
});
test('ignoring room capacity does not change section size, room type, equipment or availability checks',()=>{
 const input=fixture();input.policy.ignoreRoomCapacity=true;input.rooms[0]!.capacity=1;
 const result=buildDraftPlan(input);assert.equal(result.sections[0]?.students,20);assert.equal(result.gaps.length,0);
 for(const type of ['LAB',null] as const){const changed=structuredClone(input);changed.rooms[0]!.type=type;
  assert.equal(buildDraftPlan(changed).gaps.length,1);assert.ok(prepareSolverPayload(changed,1).tasks.every(task=>task.choices.every(choice=>choice.uncovered)));}
 const missingEquipment=structuredClone(input);missingEquipment.courses[0]!.requiredEquipment=['PC'];
 assert.equal(buildDraftPlan(missingEquipment).gaps.length,1);
 const unavailable=structuredClone(input);unavailable.rooms[0]!.available=[];
 assert.equal(buildDraftPlan(unavailable).gaps.length,1);
});
test('manual editing follows the same explicit room-capacity option and keeps component type constraints',()=>{
 const input=fixture();input.policy.ignoreRoomCapacity=true;input.rooms.push({id:'R2',name:'Small room',type:'CLASSROOM',capacity:1});
 const original=buildDraftPlan(input),session=original.sessions[0]!;
 const move={sessionId:session.id,day:session.day,start:session.start,roomId:'R2',instructorId:'I'};
 assert.equal(moveScheduledSession(input,original,move).sessions[0]?.roomId,'R2');
 input.rooms[1]!.type='LAB';assert.throws(()=>moveScheduledSession(input,original,move),/compatibility/);
});
test('source room names establish explicit facility types without turning offices into teaching rooms',()=>{
 assert.equal(roomTypeFromDescription('قاعة نظرية 3'),'CLASSROOM');
 assert.equal(roomTypeFromDescription('معمل حاسب آلي1'),'LAB');assert.equal(roomTypeFromDescription('ورشة التحكم الكهربائي'),'LAB');
 assert.equal(roomTypeFromDescription('مكتب وكيل شؤون المتدربين'),null);assert.equal(roomTypeFromDescription('مركز اختبارات'),null);
});
test('real Timefold keeps room occupancy hard when room capacity is explicitly ignored',
 {skip:!existsSync('solver/target/tps-timefold-0.2.0-jar-with-dependencies.jar')},async()=>{
 const input=fixture();input.policy.ignoreRoomCapacity=true;input.policy.slots=[{day:'SUN',from:8,to:10}];
 input.courses.push({...input.courses[0]!,code:'OTHER',blocks:['L2::B'],level:2});
 input.instructors.push({id:'I2',name:'Second synthetic',maxLoad:20,allowedModes:['ONSITE']});
 const result=await optimizeWithTimefold(input,{seconds:1,candidatesPerInstructor:2});
 assert.equal(result.sections.filter(section=>section.state==='SCHEDULED').length,1);assert.equal(result.gaps.length,1);
 assert.ok(!assessReadiness(input,result,'COMPLETED').issues.some(issue=>issue.code==='ROOM_OCCUPIED'));
});
