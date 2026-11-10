import type {PlanRequest} from './types.js';
import {sectionCapacity} from './section-capacity.js';
import {validateRequest} from './validation.js';
import {normalizeArabic} from './automatic-planning.js';

/** Split anonymous memberships at a course's new boundaries, retaining every other class size. */
export function applyCourseCapacityException(source:PlanRequest,code:string,capacity:number):PlanRequest{
  if(!Number.isInteger(capacity)||capacity<1||capacity>5000)throw new Error('Invalid course-capacity exception');
  const input=structuredClone(source),target=input.courses.find(course=>course.code===code);
  if(!target||target.theoryHours+target.practicalHours<=0||target.mode==='SELF_PACED')
    throw new Error('Capacity exception requires one known timed course');
  const economics=/مقدمه.*اقتصاد/.test(normalizeArabic(target.title));
  input.policy.courseSectionCapacities={...input.policy.courseSectionCapacities,[code]:capacity};
  if(target.demand===0){
    target.sectionCapacity=capacity;delete target.blocks;delete target.blockSizes;delete target.blockGroups;
    if(input.projection&&economics)input.projection.rules.economics=capacity;
    validateRequest(input);return input;
  }
  if(target.sectionCapacity===capacity&&target.blockSizes?.length===Math.ceil(target.demand/capacity)&&
    target.blockSizes.every((size,index)=>size===Math.min(capacity,target.demand-index*capacity))){
    if(input.projection&&economics)input.projection.rules.economics=capacity;
    validateRequest(input);return input;
  }
  const base=new Map((input.cohortBlocks??[]).map(block=>[block.ref,block]));
  if(!input.cohortBlocks)for(const course of input.courses){
    const groups=course.blockGroups??course.blocks?.map(ref=>[ref]);
    if(!groups||!course.blockSizes)throw new Error('Exact cohort sizes are required before regrouping');
    groups.forEach((members,index)=>{
      if(members.length!==1)return;
      const ref=members[0]!,size=course.blockSizes![index]!,prior=base.get(ref);
      if(prior&&(prior.size!==size||prior.level!==course.level))throw new Error('Conflicting cohort evidence');
      base.set(ref,{ref,level:course.level,size});
    });
  }
  // Validate the original memberships before altering the snapshot. Never infer missing group sizes.
  const verified=structuredClone(source);verified.cohortBlocks=[...base.values()];
  validateRequest(verified);
  const ordered=[...base.values()].filter(block=>block.level===target.level)
    .sort((a,b)=>a.ref.localeCompare(b.ref,undefined,{numeric:true}));
  if(ordered.reduce((sum,block)=>sum+block.size,0)!==target.demand)throw new Error('Course population differs from its cohort');
  const replacements=new Map<string,string[]>(),parts:Array<{ref:string;level:number;size:number;from:number;to:number}>=[];
  let offset=0;
  for(const block of ordered){
    const end=offset+block.size,cuts=[offset];
    for(let cut=(Math.floor(offset/capacity)+1)*capacity;cut<end;cut+=capacity)cuts.push(cut);
    cuts.push(end);
    const split=cuts.length>2,members:string[]=[];
    for(let index=0;index<cuts.length-1;index++){
      const ref=split?`${block.ref}~C${index+1}`:block.ref;members.push(ref);
      parts.push({ref,level:block.level,size:cuts[index+1]!-cuts[index]!,from:cuts[index]!,to:cuts[index+1]!});
    }
    replacements.set(block.ref,members);offset=end;
  }
  input.cohortBlocks=[...base.values()].filter(block=>block.level!==target.level)
    .concat(parts.map(({ref,level,size})=>({ref,level,size})));
  for(const course of input.courses){
    if(course.code===code)continue;
    // Pin the prior effective size before a specific exception changes any policy lookup.
    const prior=source.courses.find(item=>item.code===course.code)!;
    const limit=sectionCapacity(prior,source.policy);if(limit!==null)course.sectionCapacity=limit;
    const groups=course.blockGroups??course.blocks?.map(ref=>[ref]);
    if(!groups)continue;
    const expanded=groups.map(members=>members.flatMap(ref=>replacements.get(ref)??[ref]));
    course.blocks=expanded.map(members=>members.join(' + '));
    if(course.mode!=='SELF_PACED')course.blockGroups=expanded;
  }
  const groups=Array.from({length:Math.ceil(target.demand/capacity)},(_,index)=>{
    const from=index*capacity,to=Math.min(target.demand,from+capacity);
    return parts.filter(part=>part.from>=from&&part.to<=to);
  });
  target.sectionCapacity=capacity;target.blockGroups=groups.map(group=>group.map(part=>part.ref));
  target.blocks=target.blockGroups.map(members=>members.join(' + '));
  target.blockSizes=groups.map(group=>group.reduce((sum,part)=>sum+part.size,0));
  if(input.projection&&economics)input.projection.rules.economics=capacity;
  validateRequest(input);return input;
}
