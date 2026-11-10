import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,post,type Auth,type Context,type Entity} from './api';

type Exception={id:string;instructor_id:string;instructor_code:string;instructor_name:string;
  additional_hours:string;reason:string;state:string;created_at:string;decision_reason:string|null};
export default function LoadExceptionPanel({ctx,user,instructors,notify}:{
  ctx:Context;user:Auth;instructors:Entity[];notify:(message:string)=>void;
}){
  const qc=useQueryClient();
  const q=useQuery({queryKey:['load-exceptions',ctx.departmentId,ctx.termId],
    queryFn:()=>api<Exception[]>('/load-exceptions?departmentId='+ctx.departmentId+'&termId='+ctx.termId),
    enabled:!!ctx.departmentId&&!!ctx.termId});
  const [trainer,setTrainer]=useState(''),[additionalHours,setHours]=useState(2),
    [reason,setReason]=useState(''),[decisionReason,setDecisionReason]=useState(''),
    [busy,setBusy]=useState(false);
  const canApprove=['SYSTEM_ADMIN','COLLEGE_ADMIN','APPROVER'].includes(user.role);
  const canRequest=['SYSTEM_ADMIN','COLLEGE_ADMIN','DEPARTMENT_HEAD','SCHEDULER'].includes(user.role);
  async function run(task:()=>Promise<unknown>){
    setBusy(true);
    try{await task();await qc.invalidateQueries({queryKey:['load-exceptions',ctx.departmentId,ctx.termId]});
      notify('تم تحديث طلب الاستثناء وسجله');
    }catch(e){notify('لم يكتمل الإجراء: '+String(e instanceof Error?e.message:e));}
    finally{setBusy(false);}
  }
  return <section><h3>استثناءات النصاب للفصل التدريبي</h3>
    <p className="hint">لا يُضاف استثناء النصاب إلى الجدولة إلا بعد الموافقة عليه صراحة. سجل الطلب مستقل عن النصاب الأساسي، والتغييرات تسري على السيناريوهات الجديدة فقط.</p>
    {canRequest&&<div className="form-grid">
      <label>المدرب<select value={trainer} onChange={e=>setTrainer(e.target.value)}>
        <option value="">اختر المدرب</option>
        {instructors.map(i=><option key={i.id} value={i.id}>{String(i.code)} — {String(i.name)}</option>)}
      </select></label>
      <label>ساعات إضافية<input type="number" min=".5" max="30" step=".5"
        value={additionalHours} onChange={e=>setHours(Number(e.target.value))}/></label>
      <label>مبرر طلب الزيادة<input value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <button disabled={busy||!trainer||reason.trim().length<8} onClick={()=>run(async()=>{
        await post('/load-exceptions',{instructorId:trainer,termId:ctx.termId,
          additionalHours,reason});setReason('');
      })}>إرسال طلب اعتماد الاستثناء</button>
    </div>}
    {canApprove&&<label>مبرر قرار الاعتماد أو الرفض<input value={decisionReason}
      onChange={e=>setDecisionReason(e.target.value)}/></label>}
    <div className="table-wrap"><table><thead><tr><th>المدرب</th><th>الزيادة</th><th>السبب</th><th>الحالة</th><th>الإجراء</th></tr></thead>
      <tbody>{(q.data??[]).map(v=><tr key={v.id}><td>{v.instructor_name}</td>
        <td>{Number(v.additional_hours)}</td><td>{v.reason}</td><td>{v.state}</td>
        <td>{canApprove&&v.state==='PENDING'?<div className="actions">
          <button disabled={busy||decisionReason.trim().length<8}
            onClick={()=>run(()=>post('/load-exceptions/'+v.id+'/decision',{
              decision:'APPROVED',reason:decisionReason}))}>اعتماد</button>
          <button disabled={busy||decisionReason.trim().length<8}
            onClick={()=>run(()=>post('/load-exceptions/'+v.id+'/decision',{
              decision:'REJECTED',reason:decisionReason}))}>رفض</button>
        </div>:'—'}</td></tr>)}</tbody></table></div>
  </section>;
}
