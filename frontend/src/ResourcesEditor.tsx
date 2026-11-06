import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,post,type Auth,type Context,type Entity} from './api';
import LoadExceptionPanel from './LoadExceptionPanel';

type Mode='ONSITE'|'REMOTE'|'SELF_PACED'|'HYBRID';
const modes:Mode[]=['ONSITE','REMOTE','SELF_PACED','HYBRID'];
const modeName:Record<Mode,string>={ONSITE:'حضوري',REMOTE:'عن بُعد',SELF_PACED:'ذاتي',HYBRID:'مدمج'};
function Modes({value,change}:{value:Mode[];change:(v:Mode[])=>void}){
  return <div className="actions">{modes.map(m=><label key={m} style={{display:'flex',flexDirection:'row'}}>
    <input type="checkbox" checked={value.includes(m)}
      onChange={e=>change(e.target.checked?[...value,m]:value.filter(v=>v!==m))}/>{modeName[m]}</label>)}</div>;
}
type Window={day:'SUN'|'MON'|'TUE'|'WED'|'THU';from:number;to:number};
function Windows({value,change}:{value:Window[]|undefined;change:(v:Window[]|undefined)=>void}){
  const [text,setText]=useState(value?JSON.stringify(value):'');
  const [error,setError]=useState('');
  return <label>نوافذ الإتاحة (JSON، تقبل 8.5 = 08:30، فارغ = لا قيود إضافية)<textarea style={{minHeight:60}} dir="ltr"
    value={text} onChange={e=>{setText(e.target.value);setError('');
      try{change(e.target.value.trim()?JSON.parse(e.target.value) as Window[]:undefined);}catch{setError('صيغة JSON غير صحيحة');}}}/>
    {error&&<small className="error">{error}</small>}</label>;
}
function TrainerRow({item,save}:{item:Entity;save:(id:string,v:unknown)=>Promise<void>}){
  const [name,setName]=useState(String(item.name??'')),[load,setLoad]=useState(Number(item.maxLoad??0)),
    [allowed,setAllowed]=useState<Mode[]>((item.allowedModes??['ONSITE']) as Mode[]),
    [courses,setCourses]=useState((item.eligibleCourseCodes as string[]|null)?.join(',')??''),
    [available,setAvailable]=useState<Window[]|undefined>((item.available as Window[]|null)??undefined);
  return <details><summary>{String(item.code)} — {name} | النصاب {load}</summary>
    <div className="form-grid"><label>اسم المدرب<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>النصاب الأساسي<input type="number" min="0" value={load} onChange={e=>setLoad(+e.target.value)}/></label>
      <label>المقررات المؤهل لتدريسها (فارغ = غير مقيّد)<input value={courses} onChange={e=>setCourses(e.target.value)}/></label>
    </div>
    <h3>أنماط المدرب المؤهل لها</h3><Modes value={allowed} change={setAllowed}/>
    <Windows value={available} change={setAvailable}/>
    <button onClick={()=>save(item.id,{name,maxLoad:load,allowedModes:allowed,
      eligibleCourseCodes:courses.trim()?courses.split(',').map(x=>x.trim()).filter(Boolean):null,
      available:available??null})}>حفظ بيانات المدرب</button>
  </details>;
}
function RoomRow({item,save}:{item:Entity;save:(id:string,v:unknown)=>Promise<void>}){
  const [name,setName]=useState(String(item.name??'')),[type,setType]=useState(String(item.type??'CLASSROOM')),
    [capacity,setCapacity]=useState(Number(item.capacity??30)),[building,setBuilding]=useState(String(item.building??'')),
    [available,setAvailable]=useState<Window[]|undefined>((item.available as Window[]|null)??undefined);
  return <details><summary>{String(item.code)} — {name} | السعة {capacity}</summary>
    <div className="form-grid"><label>اسم القاعة<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>السعة<input type="number" min="1" value={capacity} onChange={e=>setCapacity(+e.target.value)}/></label>
      <label>المبنى<input value={building} onChange={e=>setBuilding(e.target.value)}/></label>
      <label>نوع القاعة<select value={type} onChange={e=>setType(e.target.value)}>
        <option value="CLASSROOM">نظرية</option><option value="LAB">معمل</option><option value="MULTI">متعددة</option>
      </select></label></div>
    <Windows value={available} change={setAvailable}/>
    <button onClick={()=>save(item.id,{name,capacity,building,type,available:available??null})}>حفظ بيانات القاعة</button>
  </details>;
}
export default function ResourcesEditor({ctx,user,notify}:{ctx:Context;user:Auth;notify:(v:string)=>void}){
  const qc=useQueryClient();
  const trainers=useQuery({queryKey:['instructors',ctx.departmentId],queryFn:()=>api<Entity[]>('/instructors?departmentId='+ctx.departmentId),enabled:!!ctx.departmentId});
  const rooms=useQuery({queryKey:['rooms',ctx.collegeId],queryFn:()=>api<Entity[]>('/rooms?collegeId='+ctx.collegeId),enabled:!!ctx.collegeId});
  const [trainer,setTrainer]=useState({code:'',name:'',maxLoad:18,eligibleCourseCodes:''});
  const [room,setRoom]=useState({code:'',name:'',type:'CLASSROOM',capacity:30,building:''});
  const canEdit=['SYSTEM_ADMIN','COLLEGE_ADMIN','DEPARTMENT_HEAD','SCHEDULER'].includes(user.role);
  const canManageRooms=canEdit&&(!user.departmentId||user.role==='SYSTEM_ADMIN');
  async function run(task:()=>Promise<unknown>){
    try{await task();notify('تم حفظ التعديل');await qc.invalidateQueries();}
    catch(e){notify('فشل حفظ البيانات: '+String(e instanceof Error?e.message:e));}
  }
  async function edit(base:string,id:string,payload:unknown){
    await run(()=>api(base+'/'+id,{method:'PATCH',body:JSON.stringify(payload)}));
  }
  return <section className="panel"><h2>٣. المدربون والأنصبة والقاعات</h2>
    <div className="split"><section><h3>إضافة مدرب</h3><div className="form-grid">
      <label>الرمز<input value={trainer.code} onChange={e=>setTrainer({...trainer,code:e.target.value})}/></label>
      <label>الاسم<input value={trainer.name} onChange={e=>setTrainer({...trainer,name:e.target.value})}/></label>
      <label>النصاب الأساسي<input type="number" min="0" value={trainer.maxLoad} onChange={e=>setTrainer({...trainer,maxLoad:+e.target.value})}/></label>
      <label>مقررات الأهلية (اختياري)<input value={trainer.eligibleCourseCodes} onChange={e=>setTrainer({...trainer,eligibleCourseCodes:e.target.value})}/></label>
    </div><button className="primary" disabled={!canEdit} onClick={()=>run(()=>post('/instructors',{
      departmentId:ctx.departmentId,code:trainer.code,name:trainer.name,maxLoad:trainer.maxLoad,
      ...(trainer.eligibleCourseCodes.trim()?{eligibleCourseCodes:trainer.eligibleCourseCodes.split(',').map(x=>x.trim()).filter(Boolean)}:{})
    }))}>إضافة مدرب</button><h3>المدربون المسجلون</h3>
    {(trainers.data??[]).map(x=><TrainerRow key={x.id} item={x} save={(id,v)=>edit('/instructors',id,v)}/>)}
    <LoadExceptionPanel ctx={ctx} user={user} instructors={trainers.data??[]} notify={notify}/>
    </section><section><h3>إضافة قاعة أو معمل</h3><div className="form-grid">
      <label>الرمز<input value={room.code} onChange={e=>setRoom({...room,code:e.target.value})}/></label>
      <label>الاسم<input value={room.name} onChange={e=>setRoom({...room,name:e.target.value})}/></label>
      <label>السعة<input type="number" min="1" value={room.capacity} onChange={e=>setRoom({...room,capacity:+e.target.value})}/></label>
      <label>نوع القاعة<select value={room.type} onChange={e=>setRoom({...room,type:e.target.value})}>
        <option value="CLASSROOM">نظرية</option><option value="LAB">معمل</option><option value="MULTI">متعددة</option>
      </select></label>
      <label>المبنى<input value={room.building} onChange={e=>setRoom({...room,building:e.target.value})}/></label>
    </div><button className="primary" disabled={!canManageRooms} onClick={()=>run(()=>post('/rooms',{collegeId:ctx.collegeId,...room}))}>إضافة قاعة</button>
    {!canManageRooms&&<p className="hint">تعديل القاعات المشتركة يتطلب صلاحية إدارة على مستوى الكلية.</p>}
    <h3>القاعات المسجلة</h3>
    {(rooms.data??[]).map(x=><RoomRow key={x.id} item={x} save={(id,v)=>edit('/rooms',id,v)}/>)}</section></div>
  </section>;
}
