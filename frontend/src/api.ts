export type Auth={id:string;username:string;role:string;collegeId:string|null;departmentId:string|null;csrfToken:string};
export type Entity={id:string;name?:string;code?:string;label?:string;[key:string]:unknown};
export type Plan={
  externalSections?:Array<{id:string;courseCode:string;title:string;level:number;students:number;capacity:number;contactHours:number;
    responsibleDepartment:string|null;status:string}>;
  sections:Array<{id:string;courseCode:string;level:number;students:number;blockId:string|null;state:string;mode:string;instructorId:string|null;contactHours:number}>;
  sessions:Array<{id:string;sectionId:string;courseCode:string;instructorId:string;roomId:string|null;day:string;start:number;end:number;mode:string;blockId:string|null}>;
  gaps:Array<{sectionId:string;courseCode:string;reason:string;contactHours:number;equivalentLoad:number}>;
  instructorLoads:Array<{id:string;credited:number;contact:number;remaining:number}>;
  metrics:{sectionCount:number;requiredContactHours:number;assignedContactHours:number;uncoveredSectionCount:number;uncoveredContactHours:number};
  notices:string[];
};
export type Scenario={id:string;name:string;state:string;solver_status:string;revision:number;result_snapshot:Plan;[key:string]:unknown};
export type Context={collegeId:string;departmentId:string;termId:string};
let csrf='';
export function setCSRF(token:string){csrf=token;}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const headers=new Headers(options.headers);
  if(options.body && !headers.has('Content-Type'))headers.set('Content-Type','application/json');
  if(options.method && options.method!=='GET'&&options.method!=='HEAD'&&csrf)headers.set('X-CSRF-Token',csrf);
  const response=await fetch('/api/v1'+path,{...options,headers,credentials:'same-origin'});
  let data:unknown;try{data=await response.json();}catch{data={error:'Unexpected server response'};}
  if(!response.ok)throw new Error(String((data as {error?:string}).error??'Request failed'));
  return data as T;
}
export function post<T>(path:string,body:unknown):Promise<T>{
  return api<T>(path,{method:'POST',body:JSON.stringify(body)});
}
export const localDate=(value:string)=>new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',dateStyle:'medium'}).format(new Date(value));
