import type {PlanRequest} from './types.js';
import {sectionCapacity} from './section-capacity.js';
import {validateRequest} from './validation.js';

/** Minimum section count, exact population, then as many tens as feasible with least squared imbalance. */
export function balancedSectionSizes(total:number,capacity:number):number[]{
 if(!Number.isInteger(total)||total<0||total>7500||!Number.isInteger(capacity)||capacity<1||capacity>5000)
  throw new Error('Invalid section balancing population or capacity');
 if(!total)return [];
 const count=Math.ceil(total/capacity);if(count===1)return [total];
 const minimum=total>=10*count?10:Math.max(1,Math.floor(total/count));
 const roundedMin=Math.ceil(minimum/10),roundedMax=Math.floor(capacity/10);
 let best:number[]|undefined,bestCost=Infinity;
 for(let rounded=count;rounded>=0;rounded--){
  if(rounded&&roundedMin>roundedMax)continue;
  const tail=count-rounded;
  const lower=rounded?Math.max(rounded*roundedMin,Math.ceil((total-tail*capacity)/10)):0;
  const upper=rounded?Math.min(rounded*roundedMax,Math.floor((total-tail*minimum)/10)):0;
  for(let units=lower;units<=upper;units++){
   const remaining=total-units*10;
   if(tail?remaining<tail*minimum||remaining>tail*capacity:remaining!==0)continue;
   const low=rounded?Math.floor(units/rounded):0,highCount=rounded?units%rounded:0;
   if(rounded&&(low<roundedMin||low+(highCount?1:0)>roundedMax))continue;
   const sizes=[...Array(highCount).fill((low+1)*10),...Array(rounded-highCount).fill(low*10)];
   if(tail){const small=Math.floor(remaining/tail),large=remaining%tail;
    sizes.push(...Array(large).fill(small+1),...Array(tail-large).fill(small));}
   const cost=sizes.reduce((sum,size)=>sum+size*size,0);
   if(cost<bestCost){best=sizes;bestCost=cost;}
  }
  if(best)return best;
 }
 throw new Error('No capacity-safe integer distribution');
}

/** Repartition only scenario two, preserving every anonymous learner and other course section sizes. */
export function rebalanceSecondScenario(source:PlanRequest):PlanRequest{
 if(source.projection?.key!=='CAP_100_50_40')return source;
 validateRequest(source);
 const changes=new Map<string,number[]>();
 for(const course of source.courses){
  if(course.assignmentScope==='EXTERNAL'||course.mode==='SELF_PACED'||!course.demand)continue;
  if(!(course.theoryHours>0&&course.practicalHours===0)&&!course.blockSizes?.some(size=>size<10))continue;
  const capacity=sectionCapacity(course,source.policy);if(capacity===null)continue;
  const sizes=balancedSectionSizes(course.demand,capacity);
  if(JSON.stringify(sizes)!==JSON.stringify(course.blockSizes))changes.set(course.code,sizes);
 }
 if(!changes.size)return source;
 if(!source.cohortBlocks?.length)throw new Error('Verified cohort memberships required before balancing');
 const input=structuredClone(source),levels=new Set(source.courses.filter(course=>changes.has(course.code)).map(course=>course.level));
 type Part={ref:string;level:number;size:number;from:number;to:number};
 const replacements=new Map<string,Part[]>(),partsByLevel=new Map<number,Part[]>();
 for(const level of levels){
  const cuts=new Set<number>();
  for(const course of source.courses.filter(course=>course.level===level&&changes.has(course.code))){let at=0;
   for(const size of changes.get(course.code)!){at+=size;cuts.add(at);}}
  const blocks=source.cohortBlocks.filter(block=>block.level===level).sort((a,b)=>a.ref.localeCompare(b.ref,undefined,{numeric:true}));
  let offset=0;const parts:Part[]=[];
  for(const block of blocks){const end=offset+block.size,boundaries=[offset,...[...cuts].filter(cut=>cut>offset&&cut<end).sort((a,b)=>a-b),end];
   const next=boundaries.slice(1).map((to,index)=>({ref:boundaries.length>2?`${block.ref}~B${index+1}`:block.ref,level,size:to-boundaries[index]!,from:boundaries[index]!,to}));
   replacements.set(block.ref,next);parts.push(...next);offset=end;}
  partsByLevel.set(level,parts);
 }
 input.cohortBlocks=source.cohortBlocks.flatMap(block=>(replacements.get(block.ref)??[block]).map(({ref,level,size})=>({ref,level,size})));
 for(const course of input.courses){
  const sizes=changes.get(course.code);
  if(sizes){let from=0;course.blockGroups=sizes.map(size=>{const to=from+size,members=partsByLevel.get(course.level)!.filter(part=>part.from>=from&&part.to<=to).map(part=>part.ref);from=to;return members;});
   course.blockSizes=sizes;
  }else{
   const previous=course.blockGroups??course.blocks?.map(ref=>[ref]);if(!previous)continue;
   course.blockGroups=previous.map(group=>group.flatMap(ref=>replacements.get(ref)?.map(part=>part.ref)??[ref]));
  }
  course.blocks=course.blockGroups.map(group=>group.join(' + '));
 }
 for(const level of levels)input.projection!.baseBlocksByLevel[level]=input.cohortBlocks.filter(block=>block.level===level).length;
 const note='أعيد توزيع شعب السيناريو الثاني بأعداد صحيحة متوازنة ومقربة للعشرات قدر الإمكان، مع دمج الشعب الأصغر من 10 متى سمحت السعة وحفظ إجمالي المتدربين.';
 if(!input.projection!.assumptions.includes(note))input.projection!.assumptions.push(note);
 for(const [code,sizes] of changes)if(sizes.some(size=>size<10))input.projection!.assumptions.push(`تعذر بلوغ 10 متدربين لكل شعبة في ${code} ضمن العدد الكلي والسعة المعتمدة؛ بقي كل المتدربين محفوظين.`);
 validateRequest(input);return input;
}
