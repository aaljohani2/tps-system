import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,post,type Scenario} from './api';
type Run={id:string;status:string;started_at:string;finished_at:string|null;
  elapsed_ms:number|null;score:{hard?:number;soft?:number}|null;error_message:string|null;progress_stage:string;progress_at:string;requested_settings?:{seconds:number;candidatesPerInstructor:number}|null};
export default function SolverRunsPanel({scenario,notify,canEdit}:{scenario:Scenario;notify:(s:string)=>void;canEdit:boolean}){
  const qc=useQueryClient();
  const query=useQuery({queryKey:['solver-runs',scenario.id,scenario.solver_status],
    queryFn:()=>api<Run[]>('/scenarios/'+scenario.id+'/runs'),enabled:!!scenario.id,
    refetchInterval:scenario.solver_status==='RUNNING'?1500:false});
  const records=query.data??[];
  const stageText:Record<string,string>={QUEUED:'تم قبول الطلب',VALIDATING:'التحقق من البيانات',PREPARING:'تحضير البدائل',SOLVING:'Timefold يعالج البدائل',VERIFYING:'فحص النتيجة',SAVING:'حفظ النتيجة',COMPLETED:'مكتمل',FAILED:'فشل',CANCELLED:'ملغى'};
  async function recover(){
    try{
      await post('/scenarios/'+scenario.id+'/runs/recover',{});
      notify('أُغلقت عملية Timefold المتوقفة بعد تحقق مدة التعافي. يمكن إعادة تشغيل المسودة.');
      await qc.invalidateQueries({queryKey:['solver-runs',scenario.id]});
      await qc.invalidateQueries({queryKey:['scenario',scenario.id]});
    }catch(e){notify('تعذر التعافي: '+String(e instanceof Error?e.message:e));}
  }
  async function cancel(){
    try{
      await post('/scenarios/'+scenario.id+'/runs/cancel',{});
      notify('تم إلغاء تشغيل Timefold النشط دون حفظ نتيجة غير مكتملة.');
      await qc.invalidateQueries({queryKey:['solver-runs',scenario.id]});
      await qc.invalidateQueries({queryKey:['scenario',scenario.id]});
      await qc.invalidateQueries({queryKey:['scenarios']});
    }catch(e){notify('تعذر إلغاء المحرك: '+String(e instanceof Error?e.message:e));}
  }
  const active=records.find(r=>r.status==='RUNNING');
  const old=!!active && Date.now()-Date.parse(active.started_at)>120000;
  return <details><summary>سجل عمليات Timefold ونتائج المحرك</summary>
    <p className="hint">تُعرض مراحل تنفيذ حقيقية دون نسبة تقدم تقديرية. تستمر عملية التحسين المحلية بعد انتهاء طلب المتصفح، لكنها ليست قائمة انتظار موزعة؛ التعافي من التشغيل المهجور يحتاج إلى مسار التعافي المحمي بعد دقيقتين.</p>
    {query.isError&&<p className="alert">تعذر تحميل سجل المحرك.</p>}
    {scenario.state==='DRAFT'&&active&&canEdit&&
      <button type="button" onClick={cancel}>إلغاء تشغيل Timefold النشط</button>}
    {scenario.state==='DRAFT'&&active&&old&&canEdit&&
      <button type="button" onClick={recover}>تعافٍ من محاولة حل مهجورة</button>}
    <div className="table-wrap"><table><thead><tr><th>البداية</th><th>الحالة</th><th>المرحلة الحالية</th><th>المدة</th><th>الدرجة</th><th>سبب الفشل</th></tr></thead><tbody>
      {records.map(r=><tr key={r.id}><td>{new Date(r.started_at).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}</td>
        <td>{r.status==='CANCELLED'?'ملغاة':r.status}</td><td>{stageText[r.progress_stage]??r.progress_stage??'—'}</td><td>{r.elapsed_ms===null?'—':(r.elapsed_ms/1000).toFixed(2)+' ث'}</td>
        <td>{r.score?('hard='+r.score.hard+' / soft='+r.score.soft):'—'}</td>
        <td>{r.error_message??'—'}</td></tr>)}</tbody></table></div>
  </details>;
}
