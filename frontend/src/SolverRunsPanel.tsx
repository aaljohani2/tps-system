import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,post,type Scenario} from './api';
type Run={id:string;status:string;started_at:string;finished_at:string|null;
  elapsed_ms:number|null;score:{hard?:number;soft?:number}|null;error_message:string|null};
export default function SolverRunsPanel({scenario,notify}:{scenario:Scenario;notify:(s:string)=>void}){
  const qc=useQueryClient();
  const query=useQuery({queryKey:['solver-runs',scenario.id],
    queryFn:()=>api<Run[]>('/scenarios/'+scenario.id+'/runs'),enabled:!!scenario.id});
  const records=query.data??[];
  async function recover(){
    try{
      await post('/scenarios/'+scenario.id+'/runs/recover',{});
      notify('أُغلقت عملية Timefold المتوقفة بعد تحقق مدة التعافي. يمكن إعادة تشغيل المسودة.');
      await qc.invalidateQueries({queryKey:['solver-runs',scenario.id]});
      await qc.invalidateQueries({queryKey:['scenario',scenario.id]});
    }catch(e){notify('تعذر التعافي: '+String(e instanceof Error?e.message:e));}
  }
  const active=records.find(r=>r.status==='RUNNING');
  const old=!!active && Date.now()-Date.parse(active.started_at)>120000;
  return <details><summary>سجل عمليات Timefold ونتائج المحرك</summary>
    <p className="hint">يبين السجل حالة المحاولة والمدة والدرجة عند اكتمالها. التعافي مسموح للمحاولة التي بقيت قيد التشغيل أكثر من دقيقتين، ولا يوقف عملية Java نشطة؛ ولا يشكل زرًا للإلغاء الفوري.</p>
    {query.isError&&<p className="alert">تعذر تحميل سجل المحرك.</p>}
    {scenario.state==='DRAFT'&&active&&old&&
      <button onClick={recover}>تعافٍ من محاولة حل مهجورة</button>}
    <div className="table-wrap"><table><thead><tr><th>البداية</th><th>الحالة</th><th>المدة</th><th>الدرجة</th><th>سبب الفشل</th></tr></thead><tbody>
      {records.map(r=><tr key={r.id}><td>{new Date(r.started_at).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}</td>
        <td>{r.status}</td><td>{r.elapsed_ms===null?'—':(r.elapsed_ms/1000).toFixed(2)+' ث'}</td>
        <td>{r.score?('hard='+r.score.hard+' / soft='+r.score.soft):'—'}</td>
        <td>{r.error_message??'—'}</td></tr>)}</tbody></table></div>
  </details>;
}
