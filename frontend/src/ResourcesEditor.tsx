import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,post,type Auth,type Context,type Entity} from './api';
import LoadExceptionPanel from './LoadExceptionPanel';
import RayatResourceImport from './RayatResourceImport';
import InstructorRulesFields,{type TeachingRules} from './InstructorRulesFields';

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
function TrainerRow({item,save,lifecycle,canEdit}:{item:Entity;save:(id:string,v:unknown)=>Promise<void>;
  lifecycle:(id:string,active:boolean,reason:string)=>Promise<void>;canEdit:boolean}){
  const [name,setName]=useState(String(item.name??'')),[load,setLoad]=useState(Number(item.maxLoad??0)),
    [allowed,setAllowed]=useState<Mode[]>((item.allowedModes??['ONSITE']) as Mode[]),
    [courses,setCourses]=useState((item.eligibleCourseCodes as string[]|null)?.join(',')??''),
    [specialties,setSpecialties]=useState((item.specialties as string[]|undefined)?.join(',')??''),
    [available,setAvailable]=useState<Window[]|undefined>((item.available as Window[]|null)??undefined),
    [teachingRules,setTeachingRules]=useState<TeachingRules>((item.teachingRules as TeachingRules|undefined)??{}),
    [archiveReason,setArchiveReason]=useState('');
  const active=item.active!==false;
  return <details><summary>{String(item.code)} — {name} | النصاب {load} | {active?'نشط':'مؤرشف'}</summary>
    <div className="form-grid"><label>اسم المدرب<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>النصاب الأساسي<input type="number" min="0" value={load} onChange={e=>setLoad(+e.target.value)}/></label>
      <label>المقررات المؤهل لتدريسها (فارغ = غير مقيّد)<input value={courses} onChange={e=>setCourses(e.target.value)}/></label>
      <label>رموز التخصصات المثبتة للمدرب (فواصل، مثال: ACCOUNTING,ERP)<input value={specialties} onChange={e=>setSpecialties(e.target.value)}/></label>
    </div>
    <h3>أنماط المدرب المؤهل لها</h3><Modes value={allowed} change={setAllowed}/>
    <Windows value={available} change={setAvailable}/>
    <InstructorRulesFields value={teachingRules} change={setTeachingRules}/>
    <button disabled={!canEdit||!active} onClick={()=>save(item.id,{name,maxLoad:load,allowedModes:allowed,
      eligibleCourseCodes:courses.trim()?courses.split(',').map(x=>x.trim()).filter(Boolean):null,
      specialties:specialties.split(',').map(x=>x.trim()).filter(Boolean),
      available:available??null,teachingRules})}>حفظ بيانات المدرب</button>
    <label>مبرر الأرشفة أو الاستعادة<input value={archiveReason} onChange={e=>setArchiveReason(e.target.value)}/></label>
    <button disabled={!canEdit||archiveReason.trim().length<8} onClick={()=>lifecycle(item.id,!active,archiveReason)}>{active?'أرشفة المدرب':'استعادة المدرب'}</button>
  </details>;
}
function RoomRow({item,save,lifecycle,canManage}:{item:Entity;save:(id:string,v:unknown)=>Promise<void>;
  lifecycle:(id:string,active:boolean,reason:string)=>Promise<void>;canManage:boolean}){
  const [name,setName]=useState(String(item.name??'')),[type,setType]=useState(String(item.type??'')),
    [capacity,setCapacity]=useState(String(item.capacity??'')),[building,setBuilding]=useState(String(item.building??'')),
    [equipment,setEquipment]=useState((item.equipmentCodes as string[]|undefined)?.join(',')??''),
    [available,setAvailable]=useState<Window[]|undefined>((item.available as Window[]|null)??undefined),
    [archiveReason,setArchiveReason]=useState('');
  const active=item.active!==false;
  return <details><summary>{String(item.code)} — {name} | السعة {capacity||'غير موثقة'} | {type?'':'النوع غير موثق | '}{active?'نشطة':'مؤرشفة'}</summary>
    <div className="form-grid"><label>اسم القاعة<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>السعة<input type="number" min="1" placeholder="غير موثقة" value={capacity} onChange={e=>setCapacity(e.target.value)}/></label>
      <label>المبنى<input value={building} onChange={e=>setBuilding(e.target.value)}/></label>
      <label>التجهيزات المتاحة (رموز مفصولة بفواصل)<input value={equipment} onChange={e=>setEquipment(e.target.value)}/></label>
      <label>نوع القاعة<select value={type} onChange={e=>setType(e.target.value)}>
        <option value="">غير موثق — لا تدخل في الجدولة</option>
        <option value="CLASSROOM">نظرية</option><option value="LAB">معمل</option><option value="MULTI">متعددة</option>
      </select></label></div>
    <Windows value={available} change={setAvailable}/>
    <button disabled={!canManage||!active} onClick={()=>save(item.id,{name,capacity:capacity===''?null:Number(capacity),building,type:type||null,equipmentCodes:equipment.split(',').map(x=>x.trim()).filter(Boolean),available:available??null})}>حفظ بيانات القاعة</button>
    <label>مبرر الأرشفة أو الاستعادة<input value={archiveReason} onChange={e=>setArchiveReason(e.target.value)}/></label>
    <button disabled={!canManage||archiveReason.trim().length<8} onClick={()=>lifecycle(item.id,!active,archiveReason)}>{active?'أرشفة القاعة':'استعادة القاعة'}</button>
  </details>;
}
export default function ResourcesEditor({ctx,user,notify}:{ctx:Context;user:Auth;notify:(v:string)=>void}){
  const qc=useQueryClient();
  const trainers=useQuery({queryKey:['instructors',ctx.departmentId],queryFn:()=>api<Entity[]>('/instructors?departmentId='+ctx.departmentId+'&includeArchived=true'),enabled:!!ctx.departmentId});
  const rooms=useQuery({queryKey:['rooms',ctx.collegeId],queryFn:()=>api<Entity[]>('/rooms?collegeId='+ctx.collegeId+'&includeArchived=true'),enabled:!!ctx.collegeId});
  const [trainer,setTrainer]=useState({code:'',name:'',maxLoad:18,eligibleCourseCodes:'',specialties:''});
  const [room,setRoom]=useState({code:'',name:'',type:'CLASSROOM',capacity:30,building:'',equipmentCodes:''});
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
    <RayatResourceImport ctx={ctx} user={user} notify={notify}/>
    <div className="split"><section><h3>إضافة مدرب</h3><div className="form-grid">
      <label>الرمز<input value={trainer.code} onChange={e=>setTrainer({...trainer,code:e.target.value})}/></label>
      <label>الاسم<input value={trainer.name} onChange={e=>setTrainer({...trainer,name:e.target.value})}/></label>
      <label>النصاب الأساسي<input type="number" min="0" value={trainer.maxLoad} onChange={e=>setTrainer({...trainer,maxLoad:+e.target.value})}/></label>
      <label>مقررات الأهلية (اختياري)<input value={trainer.eligibleCourseCodes} onChange={e=>setTrainer({...trainer,eligibleCourseCodes:e.target.value})}/></label>
      <label>تخصصات المدرب (رموز مفصولة بفواصل)<input value={trainer.specialties} onChange={e=>setTrainer({...trainer,specialties:e.target.value})}/></label>
    </div><button className="primary" disabled={!canEdit} onClick={()=>run(()=>post('/instructors',{
      departmentId:ctx.departmentId,code:trainer.code,name:trainer.name,maxLoad:trainer.maxLoad,
      specialties:trainer.specialties.split(',').map(x=>x.trim()).filter(Boolean),
      ...(trainer.eligibleCourseCodes.trim()?{eligibleCourseCodes:trainer.eligibleCourseCodes.split(',').map(x=>x.trim()).filter(Boolean)}:{})
    }))}>إضافة مدرب</button><h3>المدربون المسجلون</h3>
    {(trainers.data??[]).map(x=><TrainerRow key={x.id} item={x} canEdit={canEdit}
      save={(id,v)=>edit('/instructors',id,v)} lifecycle={(id,active,reason)=>edit('/instructors',id+'/lifecycle',{active,reason})}/>)}
    <LoadExceptionPanel ctx={ctx} user={user} instructors={trainers.data??[]} notify={notify}/>
    </section><section><h3>إضافة قاعة أو معمل</h3><div className="form-grid">
      <label>الرمز<input value={room.code} onChange={e=>setRoom({...room,code:e.target.value})}/></label>
      <label>الاسم<input value={room.name} onChange={e=>setRoom({...room,name:e.target.value})}/></label>
      <label>السعة<input type="number" min="1" value={room.capacity} onChange={e=>setRoom({...room,capacity:+e.target.value})}/></label>
      <label>نوع القاعة<select value={room.type} onChange={e=>setRoom({...room,type:e.target.value})}>
        <option value="CLASSROOM">نظرية</option><option value="LAB">معمل</option><option value="MULTI">متعددة</option>
      </select></label>
      <label>المبنى<input value={room.building} onChange={e=>setRoom({...room,building:e.target.value})}/></label>
      <label>تجهيزات القاعة (رموز مفصولة بفواصل)<input value={room.equipmentCodes} onChange={e=>setRoom({...room,equipmentCodes:e.target.value})}/></label>
    </div><button className="primary" disabled={!canManageRooms} onClick={()=>run(()=>post('/rooms',{collegeId:ctx.collegeId,...room,equipmentCodes:room.equipmentCodes.split(',').map(x=>x.trim()).filter(Boolean)}))}>إضافة قاعة</button>
    {!canManageRooms&&<p className="hint">تعديل القاعات المشتركة يتطلب صلاحية إدارة على مستوى الكلية.</p>}
    <h3>القاعات المسجلة</h3>
    {(rooms.data??[]).map(x=><RoomRow key={x.id} item={x} canManage={canManageRooms}
      save={(id,v)=>edit('/rooms',id,v)} lifecycle={(id,active,reason)=>edit('/rooms',id+'/lifecycle',{active,reason})}/>)}</section></div>
  </section>;
}
