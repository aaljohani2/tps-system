import {normalizeArabic} from './automatic-planning.js';
import {packTheoryBlocks} from './cohort-grouping.js';
import {validateRequest} from './validation.js';
import {applyCourseCapacityException} from './course-capacity-exception.js';
import {applyExternalAssignments} from './external-assignment.js';
import type {PlanRequest,Course} from './types.js';

export const projectionProfiles=[
  {key:'BASE_157',label:'١ — تقدير الفصل القادم: 157 مستجدًا — الأساس 45/30',theory:45,mixed:30,practical:30,economics:50},
  {key:'CAP_100_50_40',label:'٢ — تقدير الفصل القادم: نظري 100 / مختلط 50 / عملي 40',theory:100,mixed:50,practical:40,economics:50},
  {key:'CAP_120_40_ECO50',label:'٣ — تقدير الفصل القادم: نظري ومختلط 120 / عملي 40 / اقتصاد 50',theory:120,mixed:120,practical:40,economics:50}
] as const;
export type ProjectionProfile=typeof projectionProfiles[number];

export function createCapacityProjection(base:PlanRequest,profile:ProjectionProfile,levelStudents:Record<number,number>):PlanRequest{
  const input=structuredClone(base);
  input.scenarioName=profile.label;
  for(const [level,count] of Object.entries(levelStudents))if(!Number.isInteger(Number(level))||
    Number(level)<1||Number(level)>5||!Number.isInteger(count)||count<0||count>7500)throw new Error('Invalid projected level count');
  for(const level of [1,2,3,4,5])if(levelStudents[level]===undefined)throw new Error('Missing projected level');
  const courses=input.courses.filter(c=>c.theoryHours+c.practicalHours>0&&
    !/مشروع.*انتاجي/.test(normalizeArabic(c.title))&&c.level<5);
  const economics=courses.filter(c=>/مقدمه.*اقتصاد/.test(normalizeArabic(c.title)));
  if(profile.economics!==null&&economics.length!==1)throw new Error('Economics exception must match exactly one course');
  const limit=(c:Course)=>c.assignmentScope==='EXTERNAL'?c.externalSectionCapacity??40:profile.economics!==null&&c.code===economics[0]?.code?profile.economics:
    c.theoryHours&&c.practicalHours?profile.mixed:c.theoryHours?profile.theory:profile.practical;
  const envelope=Math.max(profile.theory,profile.mixed,profile.practical);
  // The changes stay in this scenario's snapshot; shared policy/master resources are untouched.
  for(const mode of ['ONSITE','REMOTE','HYBRID'] as const)input.policy.capacities[mode]={theory:envelope,practical:envelope};
  input.cohortBlocks=[];
  const baseBlocksByLevel:Record<number,number>={};
  const partitions=new Map<number,Array<{ref:string;level:number;size:number;from:number;to:number}>>();
  for(const level of [1,2,3,4]){
    const students=levelStudents[level]!,cuts=new Set([0,students]);
    const capacities=profile.key==='BASE_157'?[30]:courses.filter(c=>c.level===level).map(limit);
    for(const cap of capacities)for(let n=cap;n<students;n+=cap)cuts.add(n);
    const ordered=[...cuts].sort((a,b)=>a-b),blocks=ordered.slice(1).map((to,index)=>({
      ref:`PROJ-L${level}::B${String(index+1).padStart(3,'0')}`,level,size:to-ordered[index]!,from:ordered[index]!,to}));
    if(students===0)blocks.length=0;
    partitions.set(level,blocks);baseBlocksByLevel[level]=blocks.length;
    input.cohortBlocks.push(...blocks.map(({ref,level,size})=>({ref,level,size})));
  }
  input.courses=courses.map(course=>{
    const c={...course,demand:levelStudents[course.level]!,sectionCapacity:limit(course)};
    const baseBlocks=partitions.get(c.level)!;
    const groups=profile.key==='BASE_157'?
      (c.practicalHours?baseBlocks.map(block=>({members:[block.ref],size:block.size})):packTheoryBlocks(baseBlocks,c.sectionCapacity)):
      Array.from({length:Math.ceil(c.demand/c.sectionCapacity)},(_,index)=>{
        const from=index*c.sectionCapacity,to=Math.min(c.demand,from+c.sectionCapacity);
        const members=baseBlocks.filter(block=>block.from>=from&&block.to<=to);
        return {members:members.map(block=>block.ref),size:members.reduce((n,block)=>n+block.size,0)};
      });
    c.blocks=groups.map(group=>group.members.join(' + '));c.blockSizes=groups.map(group=>group.size);
    c.blockGroups=groups.map(group=>group.members);
    if(!c.demand){delete c.blocks;delete c.blockSizes;delete c.blockGroups;}
    return c;
  });
  input.projection={key:profile.key,label:'تقدير مشروط للفصل القادم ضمن سياق الفصل المرجعي',
    sourceTermId:base.termId,newIntake:levelStudents[1]!,levelStudents,
    cooperativeStudents:levelStudents[5]!,cooperativeAdministrativeBlocks:Math.ceil(levelStudents[5]!/30),baseBlocksByLevel,
    assumptions:['157 مستجدًا حسب تأكيد المستخدم؛ انتقال باقي المستويات مشروط بالاجتياز.',
      'التعاوني خارج شعب المحاضرات؛ مجموعات الإشراف غير معتمدة بعد.',
      'المشروع الإنتاجي موقوف؛ سعات هذا السيناريو افتراضات تخطيطية وليست إثباتًا لسعة القاعات.'],
    rules:{theory:profile.theory,mixed:profile.mixed,practical:profile.practical,economics:profile.economics}};
  validateRequest(input);return applyExternalAssignments(applyCourseCapacityException(input,economics[0]!.code,profile.economics));
}
