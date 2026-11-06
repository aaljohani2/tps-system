import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,post,type Context,type Entity} from './api';
type Row=Entity&{size?:number;cohort_code?:string;course_code?:string;block_code?:string;level?:number};
const select=(label:string,rows:Entity[],value:string,set:(v:string)=>void)=><label>{label}
  <select value={value} onChange={e=>set(e.target.value)}><option value="">اختر</option>
    {rows.map(x=><option value={x.id} key={x.id}>{String(x.name??x.title??x.code??x.id)}</option>)}
  </select></label>;
export default function AcademicPage({ctx,notify}:{ctx:Context;notify:(s:string)=>void}){
  const qc=useQueryClient();
  const [programId,setProgramId]=useState(''),[planId,setPlanId]=useState(''),[cohortId,setCohortId]=useState('');
  const [prog,setProg]=useState({code:'',name:''});
  const [plan,setPlan]=useState({code:'',versionLabel:''});
  const [item,setItem]=useState({courseId:'',level:1,isRequired:true});
  const [cohort,setCohort]=useState({code:'',name:'',level:1,programId:''});
  const [block,setBlock]=useState({code:'',name:'',size:30});
  const [assignment,setAssignment]=useState({blockId:'',courseId:''});
  const [busy,setBusy]=useState(false);
  const programs=useQuery({queryKey:['programs',ctx.departmentId],queryFn:()=>api<Row[]>('/programs?departmentId='+ctx.departmentId)});
  const plans=useQuery({queryKey:['plans',programId],queryFn:()=>api<Row[]>('/plans?programId='+programId),enabled:!!programId});
  const items=useQuery({queryKey:['plan-items',planId],queryFn:()=>api<Row[]>('/plans/'+planId+'/items'),enabled:!!planId});
  const cohorts=useQuery({queryKey:['cohorts',ctx.departmentId],queryFn:()=>api<Row[]>('/cohorts?departmentId='+ctx.departmentId)});
  const blocks=useQuery({queryKey:['blocks',ctx.departmentId],queryFn:()=>api<Row[]>('/blocks?departmentId='+ctx.departmentId)});
  const courses=useQuery({queryKey:['courses',ctx.departmentId],queryFn:()=>api<Row[]>('/courses?departmentId='+ctx.departmentId)});
  const assignments=useQuery({queryKey:['assignments',ctx.departmentId,ctx.termId],queryFn:()=>api<Row[]>('/assignments?departmentId='+ctx.departmentId+'&termId='+ctx.termId)});
  async function run(task:()=>Promise<unknown>){
    setBusy(true);
    try{await task();notify('تم حفظ بيانات الخطة والأفواج');await qc.invalidateQueries();}
    catch(e){notify('تعذر الحفظ: '+String(e instanceof Error?e.message:e));}
    finally{setBusy(false);}
  }
  const chosenCohort=cohorts.data?.find(x=>x.id===cohortId);
  return <section className="panel"><h2>٢. البرامج والخطط والأفواج والبلوكات</h2>
    <p className="hint">سجلات علائقية مرتبطة بالقسم. البلوك يمثل فوجًا من المتدربين، ويُعاد استخدام رمزه عبر مقررات المستوى نفسه للكشف عن تعارضات الجداول. لا تُدخل أسماء المتدربين أو أرقام هوياتهم.</p>
    <div className="split"><section><h3>البرنامج التدريبي</h3>
      <div className="form-grid"><label>رمز البرنامج<input value={prog.code} onChange={e=>setProg({...prog,code:e.target.value})}/></label>
      <label>اسم البرنامج<input value={prog.name} onChange={e=>setProg({...prog,name:e.target.value})}/></label>
      <button disabled={busy} onClick={()=>run(()=>post('/programs',{departmentId:ctx.departmentId,...prog}))}>إضافة برنامج</button></div>
      {select('البرنامج',programs.data??[],programId,v=>{setProgramId(v);setPlanId('');})}
      <h3>إصدار الخطة التدريبية</h3><div className="form-grid">
        <label>رمز الخطة<input value={plan.code} onChange={e=>setPlan({...plan,code:e.target.value})}/></label>
        <label>الإصدار<input value={plan.versionLabel} onChange={e=>setPlan({...plan,versionLabel:e.target.value})}/></label>
        <button disabled={busy||!programId} onClick={()=>run(()=>post('/plans',{programId,...plan}))}>إضافة إصدار</button>
      </div>
      {select('الخطة',plans.data??[],planId,setPlanId)}
      {planId&&<><h3>مقررات الخطة والمستويات</h3><div className="form-grid">
        {select('المقرر',courses.data??[],item.courseId,v=>setItem({...item,courseId:v}))}
        <label>المستوى<input type="number" min="1" max="12" value={item.level}
          onChange={e=>setItem({...item,level:Number(e.target.value)})}/></label>
        <button disabled={busy||!item.courseId} onClick={()=>run(()=>post('/plans/'+planId+'/items',item))}>إضافة المقرر للخطة</button>
      </div><div className="table-wrap"><table><thead><tr><th>المقرر</th><th>المستوى</th><th>إلزامي</th></tr></thead><tbody>
        {(items.data??[]).map(x=><tr key={x.id}><td>{String(x.code)} — {String(x.title)}</td><td>{String(x.level)}</td><td>{x.is_required?'نعم':'لا'}</td></tr>)}
      </tbody></table></div></>}</section>
      <section><h3>الأفواج التدريبية</h3><div className="form-grid">
        <label>رمز الفوج<input value={cohort.code} onChange={e=>setCohort({...cohort,code:e.target.value})}/></label>
        <label>اسم الفوج<input value={cohort.name} onChange={e=>setCohort({...cohort,name:e.target.value})}/></label>
        <label>المستوى<input type="number" min="1" max="12" value={cohort.level}
          onChange={e=>setCohort({...cohort,level:Number(e.target.value)})}/></label>
        {select('البرنامج (اختياري)',programs.data??[],cohort.programId,v=>setCohort({...cohort,programId:v}))}
        <button disabled={busy} onClick={()=>run(()=>post('/cohorts',{departmentId:ctx.departmentId,
          ...cohort,programId:cohort.programId||null}))}>إضافة فوج</button>
      </div>
      {select('الفوج لإضافة بلوك',cohorts.data??[],cohortId,setCohortId)}
      {chosenCohort&&<div className="alert">المستوى: {String(chosenCohort.level)}. يجب ربط البلوكات بمقررات المستوى نفسه.</div>}
      <div className="form-grid">
        <label>رمز البلوك<input value={block.code} onChange={e=>setBlock({...block,code:e.target.value})}/></label>
        <label>اسم البلوك<input value={block.name} onChange={e=>setBlock({...block,name:e.target.value})}/></label>
        <label>العدد<input type="number" min="1" value={block.size} onChange={e=>setBlock({...block,size:Number(e.target.value)})}/></label>
        <button disabled={busy||!cohortId} onClick={()=>run(()=>post('/blocks',{cohortId,...block}))}>إضافة بلوك</button>
      </div><div className="table-wrap"><table><thead><tr><th>الفوج/البلوك</th><th>العدد</th><th>المستوى</th></tr></thead><tbody>
        {(blocks.data??[]).map(b=><tr key={b.id}><td>{String(b.cohort_code)}::{String(b.code)}</td><td>{String(b.size)}</td><td>{String(b.level)}</td></tr>)}
      </tbody></table></div></section></div>
    <h3>ربط البلوكات بمقررات الفصل المحدد</h3>
    <p className="hint">لا يُحسب البلوك مرتين داخل مقرر واحد. إذا لم يتطابق مجموع أحجام البلوكات المرتبطة مع الطلب المعتمد، يمنع النظام إنشاء السيناريو بدل تخمين أعداد الشعب.</p>
    <div className="form-grid">
      {select('البلوك',blocks.data??[],assignment.blockId,v=>setAssignment({...assignment,blockId:v}))}
      {select('المقرر',courses.data??[],assignment.courseId,v=>setAssignment({...assignment,courseId:v}))}
      <button disabled={busy||!assignment.blockId||!assignment.courseId} onClick={()=>run(()=>post('/assignments',{...assignment,termId:ctx.termId}))}>ربط البلوك بالمقرر</button>
    </div><div className="table-wrap"><table><thead><tr><th>المقرر</th><th>الفوج</th><th>البلوك</th><th>العدد</th><th></th></tr></thead><tbody>
      {(assignments.data??[]).map(a=><tr key={a.id}><td>{String(a.course_code)}</td><td>{String(a.cohort_code)}</td><td>{String(a.block_code)}</td>
        <td>{String(a.size)}</td><td><button disabled={busy} onClick={()=>run(()=>api('/assignments/'+a.id,{method:'DELETE'}))}>إلغاء الربط</button></td></tr>)}
    </tbody></table></div>
  </section>;
}
