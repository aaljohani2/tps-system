/** Stable base-block identities must be preserved when a theory class combines blocks. */
export interface BaseBlock {ref:string;size:number}
export interface GroupedBlocks {members:string[];size:number}

/** Greedy first-fit decreasing bin packing, restricted to one original cohort.
 * Never splits a verified student block or combines unrelated cohorts.
 * This is a deterministic capacity-feasible heuristic, not global optimality.
 */
export function packTheoryBlocks(base:BaseBlock[],capacity:number):GroupedBlocks[]{
  if(!Number.isInteger(capacity)||capacity<1)throw new Error('Invalid theory capacity');
  if(base.some(x=>!x.ref||!Number.isInteger(x.size)||x.size<=0||x.size>capacity))
    throw new Error('Invalid or oversized base student block');
  if(new Set(base.map(b=>b.ref)).size!==base.length)
    throw new Error('Duplicate base student block');
  const byCohort=new Map<string,BaseBlock[]>();
  for(const block of base){
    const separator=block.ref.indexOf('::');
    const cohort=separator<0?block.ref:block.ref.slice(0,separator);
    byCohort.set(cohort,[...(byCohort.get(cohort)??[]),block]);
  }
  const result:GroupedBlocks[]=[];
  for(const blocks of byCohort.values()){
    const bins:GroupedBlocks[]=[];
    for(const block of [...blocks].sort((a,b)=>b.size-a.size||a.ref.localeCompare(b.ref))){
      let bin=bins.find(x=>x.size+block.size<=capacity);
      if(!bin){bin={members:[],size:0};bins.push(bin);}
      bin.members.push(block.ref);
      bin.size+=block.size;
    }
    result.push(...bins.map(bin=>({...bin,members:bin.members.sort()})));
  }
  return result;
}

/** Fully overlapping membership is only needed for merged sections.
 * Legacy single-block snapshots remain compatible.
 */
export function hasSharedBlock(a:{blockId:string|null;blockIds?:string[]},
  b:{blockId:string|null;blockIds?:string[]}):boolean{
  const first=a.blockIds?.length?a.blockIds:(a.blockId?[a.blockId]:[]);
  const second=b.blockIds?.length?b.blockIds:(b.blockId?[b.blockId]:[]);
  if(!first.length||!second.length)return false;
  const known=new Set(first);
  return second.some(ref=>known.has(ref));
}
