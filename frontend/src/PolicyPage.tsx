import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,post,type Auth,type Context} from './api';

type Mode='ONSITE'|'REMOTE'|'SELF_PACED'|'HYBRID';
type Day='SUN'|'MON'|'TUE'|'WED'|'THU';
type Policy={enabledModes:Mode[];capacities:Record<Mode,{theory:number|null;practical:number|null}>;
  remotePracticalLoadFactor:number;onsitePracticalLoadFactor:number;selfPacedLoadPerOffering:number|null;
  slots:{day:Day;from:number;to:number}[];sessionMaxHours:number};
type RecordPolicy={effectivePolicy:Policy;approvedRevision:number;draftPolicy:Policy;draftRevision:number;pending:boolean;updatedAt:string|null;approvedAt:string|null};
const modes:Mode[]=['ONSITE','REMOTE','SELF_PACED','HYBRID'];
const names:Record<Mode,string>={ONSITE:'حضوري',REMOTE:'عن بُعد',SELF_PACED:'ذاتي',HYBRID:'مدمج'};
const days:Day[]=['SUN','MON','TUE','WED','THU'];
const dayNames:Record<Day,string>={SUN:'الأحد',MON:'الإثنين',TUE:'الثلاثاء',WED:'الأربعاء',THU:'الخميس'};
export default function PolicyPage({ctx,user,notify}:{ctx:Context;user:Auth;notify:(v:string)=>void}){
  const qc=useQueryClient();
  const query=useQuery({queryKey:['policy',ctx.departmentId,ctx.termId],
    queryFn:()=>api<RecordPolicy>('/policies?departmentId='+ctx.departmentId+'&termId='+ctx.termId),
    enabled:!!ctx.departmentId&&!!ctx.termId});
  const [draft,setDraft]=useState<Policy|null>(null),[rationale,setRationale]=useState(''),
    [busy,setBusy]=useState(false);
  useEffect(()=>{if(query.data)setDraft(structuredClone(query.data.draftPolicy));},[query.data,ctx.departmentId,ctx.termId]);
  const editor=['SYSTEM_ADMIN','COLLEGE_ADMIN','DEPARTMENT_HEAD','SCHEDULER'].includes(user.role);
  const approver=['SYSTEM_ADMIN','COLLEGE_ADMIN','APPROVER'].includes(user.role);
  async function run(action:()=>Promise<unknown>){
    setBusy(true);
    try{await action();notify('تم حفظ تحديث السياسة');await qc.invalidateQueries({queryKey:['policy',ctx.departmentId,ctx.termId]});}
    catch(e){notify('تعذر تحديث السياسة: '+String(e instanceof Error?e.message:e));}
    finally{setBusy(false);}
  }
  function patch(v:Partial<Policy>){setDraft(p=>p?{...p,...v}:p);}
  if(!ctx.termId||!ctx.departmentId)return <section className="panel">اختر الكلية والقسم والفصل أولاً.</section>;
  if(!draft)return <section className="panel">{query.isError?'تعذر تحميل السياسة':'تحميل سياسة الفصل...'}</section>;
  const status=query.data;
  return <section className="panel">
    <h2>٤. ضبط أنماط التدريب وضوابط الجدولة</h2>
    <p className="hint">الافتراضي حضوري فقط. لا تدخل الأنماط الاختيارية في الجدولة حتى اعتماد سياسة هذا القسم والفصل، وحتى تحقق أهلية المقرر والمدرب. هذه إعدادات تخطيط محلية وليست تصريحًا من المؤسسة.</p>
    <div className="alert">السياسة المعتمدة: إصدار {status?.approvedRevision??0} — نسخة العمل: {status?.draftRevision??0}
      {status?.pending?' | توجد سياسة مقترحة لم تعتمد':' | لا توجد تغييرات معلقة'}</div>
    <fieldset disabled={!editor||busy} style={{border:0,padding:0}}>
      <h3>الأنماط المسموحة</h3>
      <div className="form-grid">{modes.map(mode=><label key={mode} style={{display:'flex',flexDirection:'row',alignItems:'center'}}>
        <input type="checkbox" checked={draft.enabledModes.includes(mode)} disabled={mode==='ONSITE'}
          onChange={e=>patch({enabledModes:e.target.checked?[...draft.enabledModes,mode]:draft.enabledModes.filter(m=>m!==mode)})}/>
        {names[mode]}</label>)}</div>
      <h3>سعات الشعب</h3>
      <div className="table-wrap"><table><thead><tr><th>النمط</th><th>سعة النظري</th><th>سعة العملي</th></tr></thead><tbody>
        {modes.filter(m=>m!=='SELF_PACED').map(mode=><tr key={mode}><td>{names[mode]}</td>{(['theory','practical'] as const).map(key=>
          <td key={key}><input aria-label={names[mode]+' '+key} type="number" min="1" max="500"
            value={draft.capacities[mode][key]??''} onChange={e=>{
              const n=Number(e.target.value);
              patch({capacities:{...draft.capacities,[mode]:{...draft.capacities[mode],[key]:n}}});
            }}/></td>)}</tr>)}
      </tbody></table></div>
      <div className="form-grid"><label>معامل نصاب العملي عن بُعد<input type="number" step=".01" min=".01" max="4"
        value={draft.remotePracticalLoadFactor} onChange={e=>patch({remotePracticalLoadFactor:Number(e.target.value)})}/></label>
      <label>معامل نصاب العملي الحضوري<input type="number" step=".01" min=".01" max="4"
        value={draft.onsitePracticalLoadFactor} onChange={e=>patch({onsitePracticalLoadFactor:Number(e.target.value)})}/></label>
      <label>نصاب العرض الذاتي (فارغ = غير محدد)<input type="number" step=".5" min="0" max="100"
        value={draft.selfPacedLoadPerOffering??''} onChange={e=>patch({selfPacedLoadPerOffering:e.target.value===''?null:Number(e.target.value)})}/></label>
      <label>الحد الأقصى لساعات اللقاء<input type="number" min="1" max="8"
        value={draft.sessionMaxHours} onChange={e=>patch({sessionMaxHours:Number(e.target.value)})}/></label></div>
      <h3>نوافذ التدريب الأسبوعية</h3>
      <p className="hint">الخميس لا يتجاوز 10:00. أما النمط المدمج فيلتزم أيضًا بالقيود الزمنية للمحرك.</p>
      <div className="table-wrap"><table><thead><tr><th>اليوم</th><th>البداية</th><th>النهاية</th><th>الإجراء</th></tr></thead><tbody>
        {draft.slots.map((slot,index)=><tr key={index}><td><select value={slot.day} onChange={e=>patch({slots:draft.slots.map((x,i)=>i===index?{...x,day:e.target.value as Day}:x)})}>
          {days.map(d=><option key={d} value={d}>{dayNames[d]}</option>)}</select></td>
          {(['from','to'] as const).map(k=><td key={k}><input type="number" min="0" max="24" step="0.5" value={slot[k]}
            onChange={e=>patch({slots:draft.slots.map((x,i)=>i===index?{...x,[k]:Number(e.target.value)}:x)})}/></td>)}
          <td><button type="button" onClick={()=>patch({slots:draft.slots.filter((_,i)=>i!==index)})}>حذف</button></td>
        </tr>)}</tbody></table></div>
      <button onClick={()=>patch({slots:[...draft.slots,{day:'SUN',from:8,to:10}]})}>إضافة نافذة زمنية</button>
      <div className="form-grid"><label>مبرر السياسة أو التعديل<textarea style={{minHeight:90}} value={rationale}
        onChange={e=>setRationale(e.target.value)} placeholder="سبب التعديل والمرجع الإداري المحلي"/></label></div>
      <button className="primary" disabled={rationale.trim().length<8} onClick={()=>run(()=>
        api('/policies',{method:'PUT',body:JSON.stringify({departmentId:ctx.departmentId,termId:ctx.termId,policy:draft,rationale})}))}>حفظ سياسة مقترحة</button>
    </fieldset>
    {approver&&<div className="actions"><button disabled={!status?.pending||busy}
      onClick={()=>run(()=>post('/policies/approve',{departmentId:ctx.departmentId,termId:ctx.termId}))}>اعتماد السياسة المقترحة</button></div>}
    {!approver&&<p className="hint">اعتماد السياسة متاح فقط لصاحب صلاحية الاعتماد. الحفظ وحده لا يفعّل الأنماط الاختيارية.</p>}
  </section>;
}
