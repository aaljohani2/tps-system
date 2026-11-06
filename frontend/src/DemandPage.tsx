import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,type Context,type Entity} from './api';
type Demand=Entity&{course_id:string;course_code:string;base_students:number;repeat_rate:string;projected_students:number;source:string;confidence:string;notes?:string};
type Assignment=Entity&{course_id:string;size:number};
function DemandRow({course,stored,blockTotal,notify,refresh,termId}:{
  course:Entity;stored?:Demand;blockTotal:number;termId:string;notify:(s:string)=>void;refresh:()=>Promise<unknown>;
}){
  const [base,setBase]=useState(Number(stored?.base_students??course.demand??0));
  const [rate,setRate]=useState(Number(stored?.repeat_rate??0.05));
  const [source,setSource]=useState(String(stored?.source??''));
  const [confidence,setConfidence]=useState(String(stored?.confidence??'MEDIUM'));
  const [notes,setNotes]=useState(String(stored?.notes??''));
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    setBase(Number(stored?.base_students??course.demand??0));setRate(Number(stored?.repeat_rate??0.05));
    setSource(String(stored?.source??''));setConfidence(String(stored?.confidence??'MEDIUM'));
    setNotes(String(stored?.notes??''));
  },[stored?.id,stored?.updated_at,course.id,course.demand]);
  const projected=Math.ceil(base*(1+rate));
  const mismatch=blockTotal>0&&blockTotal!==projected;
  async function save(){
    setBusy(true);
    try{
      await api('/demand',{method:'PUT',body:JSON.stringify({courseId:course.id,termId,baseStudents:base,
        repeatRate:rate,source,confidence,notes})});
      await refresh();notify('حُفظ تقدير الطلب للمقرر '+String(course.code));
    }catch(e){notify('فشل تحديث التقدير: '+String(e instanceof Error?e.message:e));}
    finally{setBusy(false);}
  }
  return <tr><td>{String(course.code)}<small>{String(course.title)}</small></td>
    <td><input type="number" min="0" max="5000" className="small" value={base} onChange={e=>setBase(Number(e.target.value))}/></td>
    <td><input type="number" min="0" max="0.5" step=".01" className="small" value={rate} onChange={e=>setRate(Number(e.target.value))}/></td>
    <td><strong>{projected}</strong></td><td>{blockTotal||'غير مربوط'}</td>
    <td>{mismatch?<span style={{color:'#a43d36'}}>فرق {projected-blockTotal}</span>:blockTotal?'متطابق':'يتطلب ربطًا'}</td>
    <td><input className="medium" placeholder="مصدر الأعداد" value={source} onChange={e=>setSource(e.target.value)}/></td>
    <td><select value={confidence} onChange={e=>setConfidence(e.target.value)}>
      <option value="LOW">منخفضة</option><option value="MEDIUM">متوسطة</option><option value="HIGH">مرتفعة</option>
    </select></td>
    <td><input className="medium" placeholder="ملاحظة اختيارية" value={notes} onChange={e=>setNotes(e.target.value)}/></td>
    <td><button disabled={busy||source.trim().length<3} onClick={save}>حفظ</button></td></tr>;
}
export default function DemandPage({ctx,notify}:{ctx:Context;notify:(s:string)=>void}){
  const qc=useQueryClient(),base=ctx.departmentId,term=ctx.termId;
  const courses=useQuery({queryKey:['courses',base],queryFn:()=>api<Entity[]>('/courses?departmentId='+base)});
  const demand=useQuery({queryKey:['demand',base,term],queryFn:()=>api<Demand[]>('/demand?departmentId='+base+'&termId='+term)});
  const assignments=useQuery({queryKey:['assignments',base,term],queryFn:()=>api<Assignment[]>('/assignments?departmentId='+base+'&termId='+term)});
  const counts=new Map<string,number>();
  for(const a of assignments.data??[])counts.set(a.course_id,(counts.get(a.course_id)??0)+Number(a.size));
  return <section className="panel">
    <h2>٤. تقدير الطلب المتوقع وتوزيعه على البلوكات</h2>
    <p className="hint">الطلب المتوقع = تقريب العدد الأساسي × (1 + نسبة الإعادة) إلى أعلى عدد صحيح. النسبة الافتراضية 5% قيمة تخطيطية قابلة للتعديل، وليست تعميمًا رسميًا. تُحفظ المصادر ودرجة الموثوقية لكل مقرر وفصل.</p>
    <div className="table-wrap"><table><thead><tr><th>المقرر</th><th>الطلب الأساسي</th><th>الإعادة</th><th>المتوقع</th>
      <th>مجموع البلوكات</th><th>الفرق</th><th>مصدر البيانات</th><th>الموثوقية</th><th>ملاحظات</th><th></th></tr></thead>
      <tbody>{(courses.data??[]).map(c=><DemandRow key={c.id} course={c}
        stored={demand.data?.find(x=>x.course_id===c.id)} blockTotal={counts.get(c.id)??0}
        termId={term} notify={notify} refresh={()=>qc.invalidateQueries({queryKey:['demand',base,term]})}/>)}</tbody></table></div>
    <p className="hint">إذا أُنشئت روابط بلوكات للمقرر، يجب أن تتطابق أحجامها مع طلبه المعتمد قبل إنشاء السيناريو. تبقى بيانات السيناريوهات القديمة ثابتة عند تعديل الطلب.</p>
  </section>;
}
