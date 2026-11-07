import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,type Auth,type Context} from './api';
import AutomaticPlanningPage from './AutomaticPlanningPage';
import RayatResourceImport from './RayatResourceImport';

type Kind='courses'|'instructors'|'rooms'|'blocks'|'demand';
const kinds:Kind[]=['courses','instructors','rooms','blocks','demand'];
const titles:Record<Kind,string>={courses:'المقررات',instructors:'المدربون',rooms:'القاعات والمعامل',
  blocks:'الأفواج والبلوكات',demand:'تقديرات الطلب'};
type Preview={kind:Kind;schemaVersion:string;headers:string[];
  rows:Array<Record<string,unknown>>;errors:Array<{row:number;message:string}>;
  totalRows:number;validRows:number;ready:boolean;importId:string|null};
export default function BulkImportsPage({ctx,user,notify}:{
  ctx:Context;user:Auth;notify:(message:string)=>void;
}){
  const qc=useQueryClient();
  const [kind,setKind]=useState<Kind>('instructors');
  const [file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [working,setWorking]=useState(false);
  const [committed,setCommitted]=useState(false);
  const [approvalReason,setApprovalReason]=useState('');
  const proposals=useQuery({queryKey:['course-proposals',ctx.departmentId],
    queryFn:()=>api<Array<{id:string;course_id:string;code:string;title:string;requested_mode:string;
      requested_eligible_modes:string[];requires_approval:boolean;current_mode:string;
      approved_eligible_modes:string[]}>>('/import/batch/courses/proposals?departmentId='+ctx.departmentId),
    enabled:!!ctx.departmentId});
  const canWrite=['SYSTEM_ADMIN','COLLEGE_ADMIN','DEPARTMENT_HEAD','SCHEDULER'].includes(user.role);
  const canRooms=['SYSTEM_ADMIN','COLLEGE_ADMIN'].includes(user.role)&&!user.departmentId;
  const available=kinds.filter(x=>x!=='rooms'||canRooms);
  const category=available.includes(kind)?kind:available[0];
  if(!category)return <section className="panel">لا تتوفر صلاحية استيراد جماعي لهذا الحساب.</section>;
  const base='/import/batch/'+category;
  const q='departmentId='+encodeURIComponent(ctx.departmentId)+'&termId='+encodeURIComponent(ctx.termId);
  function reset(v:Kind){
    setKind(v);setFile(null);setPreview(null);setCommitted(false);
  }
  async function upload(stage:'preview'|'commit'){
    if(!file)return;
    if(stage==='commit'&&(!preview?.ready||!preview.importId))return;
    const extension=file.name.toLowerCase().endsWith('.csv')?'csv':
      file.name.toLowerCase().endsWith('.xlsx')?'xlsx':'';
    if(!extension){notify('الملف المطلوب CSV أو XLSX فقط');return;}
    const mime=extension==='csv'?'text/csv':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    setWorking(true);
    try{
      const params=q+(stage==='commit'?'&importId='+encodeURIComponent(preview!.importId!):'');
      const result=await api<Preview|{imported:number;status:string}>(
        base+'/'+stage+'?'+params,{method:'POST',headers:{'content-type':mime},body:file});
      if(stage==='preview'){
        const rows=result as Preview;setPreview(rows);setCommitted(false);
        notify(rows.ready?'اكتملت المعاينة. راجع الصفوف ثم اختر اعتماد الاستيراد.':
          'المعاينة تحتوي أخطاء. أصلح الملف ثم أعد رفعه؛ لم تحفظ أي بيانات.');
      }else{
        const saved=result as {imported:number};
        setCommitted(true);setPreview(null);
        notify('تم اعتماد وحفظ '+saved.imported+' صفًا ضمن معاملة واحدة.');
        await qc.invalidateQueries();
      }
    }catch(e){notify('فشل الاستيراد: '+String(e instanceof Error?e.message:e));}
    finally{setWorking(false);}
  }
  return <><AutomaticPlanningPage ctx={ctx} notify={notify}/>
    <RayatResourceImport ctx={ctx} user={user} notify={notify}/><section className="panel">
    <h2>الاستيراد بالقوالب التشغيلية</h2>
    <p className="hint">تنزيل القالب ← تعبئة ملف CSV أو Excel ← المعاينة ← تصحيح الأخطاء ← اعتماد الحفظ.
      تُستخدم قاعدة PostgreSQL، وتُحفظ جميع الصفوف في معاملة واحدة، دون حذف بيانات سابقة أو منح أنماط تدريب أو استثناءات أنصبة تلقائيًا.
      صلاحية اعتماد الاستيراد هنا خاصة بالبيانات التشغيلية، وليست اعتمادًا مؤسسيًا رسميًا.</p>
    <div className="actions">
      {available.map(v=><button key={v} className={category===v?'primary':''}
        onClick={()=>reset(v)} disabled={working}>{titles[v]}</button>)}
    </div>
    {category==='courses'&&<p className="hint">عند رفع ملف المقررات تُحفظ بيانات المقرر والطلب، بينما يُسجل النمط وأهلية الأنماط المطلوبة كمقترحات فقط. لا يُفعّل أي نمط اختياري إلا بعد موافقة مستقلة من إدارة النظام.</p>}
    <div className="actions">
      <a href={'/api/v1'+base+'/template.csv'}>قالب CSV — {titles[category]}</a>
      <a href={'/api/v1'+base+'/template.xlsx'}>قالب Excel — {titles[category]}</a>
    </div>
    <div className="form-grid">
      <label>ملف {titles[category]}<input type="file" accept=".csv,.xlsx" disabled={!canWrite||working}
        onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setCommitted(false);}}/></label>
      <button disabled={!canWrite||!file||working} onClick={()=>upload('preview')}>معاينة وفحص جميع الصفوف</button>
    </div>
    {preview&&<><div className={preview.ready?'alert success':'alert'}>
      {preview.ready?'الملف صالح للعرض والموافقة.':'يحتوي الملف على أخطاء؛ لا يمكن اعتماده.'}
      {' '}الصفوف: {preview.totalRows} · المقبولة: {preview.validRows} · الأخطاء: {preview.errors.length}
    </div>
      {!!preview.errors.length&&<div className="table-wrap"><table>
        <thead><tr><th>الصف</th><th>الخطأ</th></tr></thead><tbody>
        {preview.errors.map((x,i)=><tr key={i}><td>{x.row===0?'ربط البيانات':x.row}</td>
          <td>{x.message}</td></tr>)}
        </tbody></table></div>}
      {preview.ready&&<><h3>معاينة البيانات — أول 25 صفًا</h3>
        <div className="table-wrap"><table><thead><tr>{preview.headers.map(h=><th key={h}>{h}</th>)}</tr></thead>
          <tbody>{preview.rows.slice(0,25).map((r,i)=><tr key={i}>
            {preview.headers.map(h=><td key={h}>{Array.isArray(r[h])?JSON.stringify(r[h]):
              r[h]!==null&&typeof r[h]==='object'?JSON.stringify(r[h]):String(r[h]??'')}</td>)}</tr>)}</tbody>
        </table></div>
        <button className="primary" disabled={working||!preview.importId} onClick={()=>upload('commit')}>
          اعتماد استيراد {preview.totalRows} صفًا من الملف نفسه
        </button><p className="hint">تنتهي صلاحية المعاينة بعد 30 دقيقة. عند تغيير الملف يُلغى الربط بالمعاينة السابقة.</p>
      </>}
    </>}
    {category==='courses'&&['SYSTEM_ADMIN','COLLEGE_ADMIN'].includes(user.role)&&
      <details><summary>مقترحات أهلية أنماط المقررات المستوردة</summary>
        <p className="hint">الاعتماد هنا داخلي لتخطيط الجداول، ويتطلب مبررًا صريحًا. تبقى حالة نمط المقرر نفسها دون تغيير حتى يعدلها مسؤول المقررات بعد الموافقة.</p>
        <label>مبرر قرار أهلية النمط<input value={approvalReason}
          onChange={e=>setApprovalReason(e.target.value)}/></label>
        <div className="table-wrap"><table><thead><tr><th>المقرر</th><th>النمط المقترح</th>
          <th>الأهلية المطلوبة</th><th>المعتمدة الآن</th><th>الإجراء</th></tr></thead>
          <tbody>{(proposals.data??[]).filter(p=>p.requires_approval &&
            p.requested_eligible_modes.some(m=>!p.approved_eligible_modes.includes(m))).map(p=><tr key={p.id}>
            <td>{p.code} — {p.title}</td><td>{p.requested_mode}</td>
            <td>{p.requested_eligible_modes.join('، ')}</td><td>{p.approved_eligible_modes.join('، ')}</td>
            <td><button disabled={working||approvalReason.trim().length<8}
              onClick={async()=>{setWorking(true);try{
                await api('/courses/'+p.course_id+'/eligibility',{method:'PUT',
                  body:JSON.stringify({eligibleModes:p.requested_eligible_modes,reason:approvalReason})});
                notify('اعتمدت أهلية المقرر بشكل مستقل، ويمكن ضبط النمط الحالي من إدارة المقررات.');
                await qc.invalidateQueries();
              }catch(e){notify(String(e instanceof Error?e.message:e));}
              finally{setWorking(false);}}}>اعتماد الأهلية بعد المراجعة</button></td></tr>)}
          </tbody></table></div>
      </details>}
    {committed&&<p className="success">تم الحفظ بنجاح. يمكنك مراجعة السجلات من صفحات المدربين والقاعات والبلوكات والطلب.</p>}
  </section></>;
}
