import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,type Auth,type Context} from './api';

type RoomType='CLASSROOM'|'LAB'|'MULTI';
type Instructor={code:string;name:string;maxLoad:number|null;courseEvidence:string[];
  sourceRows:number;scopeVerified:boolean;exists:boolean};
type Room={code:string;name:string;capacity:number|null;type:RoomType|null;building:string|null;
  sourceRows:number;scopeVerified:boolean;exists:boolean;needsCapacity:boolean;needsType:boolean};
type Preview={sha256:string;instructors:Instructor[];rooms:Room[];warnings:string[];
  sheets:string[];unscoped:boolean;canImportRooms:boolean;existingInstructors:number;existingRooms:number};
type Result={importedInstructors:number;existingInstructors:number;importedRooms:number;
  existingRooms:number;unresolvedRooms:number;eligibilityPending:number};
type Decision={capacity:string;type:RoomType|''};
const types:{value:RoomType;label:string}[]=[
  {value:'CLASSROOM',label:'قاعة نظرية'},{value:'LAB',label:'معمل'},{value:'MULTI',label:'متعددة الاستخدام'}];
const media=(file:File)=>file.name.toLowerCase().endsWith('.csv')?'text/csv':
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function fileProof(file:File){
  const bytes=await file.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const sha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const data=new Uint8Array(bytes),parts:string[]=[];
  for(let i=0;i<data.length;i+=8192)parts.push(String.fromCharCode(...data.subarray(i,i+8192)));
  return {name:file.name,base64:btoa(parts.join('')),sha256};
}
export default function RayatResourceImport({ctx,user,notify}:{ctx:Context;user:Auth;notify:(s:string)=>void}){
  const qc=useQueryClient();
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null);
  const [loading,setLoading]=useState(false),[accepted,setAccepted]=useState(false);
  const [importRooms,setImportRooms]=useState(false),[skipIncomplete,setSkipIncomplete]=useState(false);
  const [decisions,setDecisions]=useState<Record<string,Decision>>({});
  const [result,setResult]=useState<Result|null>(null);
  const canEdit=['SYSTEM_ADMIN','COLLEGE_ADMIN','DEPARTMENT_HEAD','SCHEDULER'].includes(user.role);
  const q='departmentId='+encodeURIComponent(ctx.departmentId)+'&collegeId='+encodeURIComponent(ctx.collegeId);
  const roomsToCreate=(preview?.rooms??[]).filter(r=>!r.exists);
  const unfinished=importRooms&&roomsToCreate.some(r=>{
    const choice=decisions[r.code];
    return !(r.capacity??Number(choice?.capacity)>0?1:0) || !(r.type||choice?.type);
  });
  const reset=(f:File|null)=>{setFile(f);setPreview(null);setResult(null);
    setDecisions({});setAccepted(false);setImportRooms(false);setSkipIncomplete(false);};
  async function analyze(){
    if(!file)return;
    setLoading(true);try{
      const report=await api<Preview>('/raiyat-resources/preview?'+q,{
        method:'POST',headers:{'content-type':media(file)},body:file});
      setPreview(report);setResult(null);setAccepted(false);setSkipIncomplete(false);
      setDecisions(Object.fromEntries(report.rooms.map(r=>[r.code,{
        capacity:r.capacity===null?'':String(r.capacity),type:r.type??''
      }])));
      setImportRooms(report.canImportRooms&&report.rooms.some(r=>!r.exists));
      notify('اكتمل تحليل ملف موارد رايات. راجع المدربين والقاعات وحقول السعة قبل الاعتماد.');
    }catch(e){setPreview(null);notify('تعذر تحليل ملف الموارد: '+String(e instanceof Error?e.message:e));}
    finally{setLoading(false);}
  }
  async function save(){
    if(!file||!preview)return;
    setLoading(true);try{
      const source=await fileProof(file);
      if(source.sha256!==preview.sha256)throw Error('تغير الملف بعد معاينته؛ ارفع الملف من جديد.');
      const roomDecisions:Record<string,{capacity:number;type:RoomType}>={};
      if(importRooms)for(const room of roomsToCreate){
        const decision=decisions[room.code],capacity=room.capacity??Number(decision?.capacity);
        const type=room.type||(decision?.type??'');
        if(Number.isInteger(capacity)&&capacity>0&&type)
          roomDecisions[room.code]={capacity,type};
      }
      const saved=await api<Result>('/raiyat-resources/commit',{
        method:'POST',body:JSON.stringify({...source,departmentId:ctx.departmentId,collegeId:ctx.collegeId,
          acceptUnscoped:accepted,importRooms,skipIncompleteRooms:skipIncomplete,roomDecisions})});
      setResult(saved);setPreview(null);
      await qc.invalidateQueries();
      notify('حُفظ المدربون والقاعات الجديدة؛ بقيت السجلات الموجودة وصلاحياتها دون تغيير.');
    }catch(e){notify('تعذر حفظ الموارد: '+String(e instanceof Error?e.message:e));}
    finally{setLoading(false);}
  }
  return <section className="panel">
    <h2>استيراد مدربي وقاعات رايات من Excel</h2>
    <p className="hint">ارفع ملف الجداول أو كشف المدربين أو القاعات بصيغتي Excel/CSV دون قالب محدد.
      يكتشف النظام عناوين الأعمدة ويزيل تكرار اللقاءات، ويربط المدربين بالقسم والقاعات بالكلية.
      المعاينة لا تحفظ أي شيء، ولا تتغير بيانات المدربين والقاعات الموجودين.</p>
    <div className="form-grid">
      <label>ملف رايات / ملف الجدول / كشف القاعات
        <input type="file" accept=".xlsx,.csv" disabled={loading||!canEdit}
          onChange={e=>reset(e.target.files?.[0]??null)}/></label>
      <button type="button" disabled={!file||loading||!canEdit} onClick={analyze}>
        اكتشاف المدربين والقاعات
      </button>
    </div>
    {preview&&<div>
      <p className="alert success">تم اكتشاف {preview.instructors.length} مدربًا ({preview.existingInstructors} موجود)
        و{preview.rooms.length} قاعة/معمل ({preview.existingRooms} موجود).
        أوراق المصدر: {preview.sheets.join('، ')||'CSV'}</p>
      {preview.warnings.map((w,i)=><p className="hint" key={i}>{w}</p>)}
      {!!preview.instructors.length&&<details open><summary>المدربون المكتشفون — المعاينة</summary>
        <div className="table-wrap"><table><thead><tr><th>رمز</th><th>اسم المدرب</th>
          <th>النصاب الوارد</th><th>مقررات الجدول السابق</th><th>الحالة</th></tr></thead>
          <tbody>{preview.instructors.map(t=><tr key={t.code}>
            <td>{t.code}</td><td>{t.name}</td><td>{t.maxLoad??'غير موثق — سيحفظ 0'}</td>
            <td>{t.courseEvidence.join('، ')||'غير موجودة في الملف'}</td>
            <td>{t.exists?'موجود؛ لن يُعدّل':'جديد'}</td></tr>)}</tbody>
        </table></div>
        <p className="hint">الإسنادات السابقة لا تمنح أهلية تدريس معتمدة تلقائيًا. المدرب الجديد يُحفظ بأهلية معلقة حتى تعتمدها من صفحة المدربين، ولا تُخترع له نوافذ إتاحة.</p>
      </details>}
      {!!preview.rooms.length&&<details open><summary>القاعات والمعامل — المعاينة</summary>
        {!preview.canImportRooms&&<div className="alert">حفظ القاعات المشتركة يحتاج صلاحية مدير النظام أو مسؤول الكلية؛ يمكنك استيراد مدربي القسم فقط.</div>}
        {preview.canImportRooms&&<label style={{display:'flex',flexDirection:'row',gap:10}}>
          <input type="checkbox" checked={importRooms} onChange={e=>setImportRooms(e.target.checked)}/>
          استيراد القاعات الجديدة إلى الكلية</label>}
        <div className="table-wrap"><table><thead><tr><th>رمز القاعة</th><th>الاسم</th>
          <th>السعة</th><th>النوع</th><th>المبنى</th><th>الحالة</th></tr></thead><tbody>
          {preview.rooms.map(r=><tr key={r.code}>
            <td>{r.code}</td><td>{r.name}</td>
            <td>{r.exists?r.capacity??'محفوظ مسبقًا':r.capacity??(
              <input className="small" type="number" min="1" max="1000" disabled={!importRooms||loading}
                placeholder="سعة موثقة" value={decisions[r.code]?.capacity??''}
                onChange={e=>setDecisions(d=>({...d,[r.code]:{...d[r.code]!,capacity:e.target.value}}))}/>)}</td>
            <td>{r.exists?'محفوظ مسبقًا':r.type??(
              <select disabled={!importRooms||loading} value={decisions[r.code]?.type??''}
                onChange={e=>setDecisions(d=>({...d,[r.code]:{...d[r.code]!,type:e.target.value as RoomType|''}}))}>
                <option value="">اختر النوع</option>
                {types.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select>)}</td>
            <td>{r.building||'—'}</td><td>{r.exists?'موجودة؛ لن تُعدّل':
              (r.needsCapacity||r.needsType)?'تحتاج استكمال': 'جديدة'}</td>
          </tr>)}</tbody></table></div>
        {!!roomsToCreate.length&&<label style={{display:'flex',flexDirection:'row',gap:10}}>
          <input type="checkbox" disabled={!importRooms} checked={skipIncomplete}
            onChange={e=>setSkipIncomplete(e.target.checked)}/>
          تجاهل القاعات ذات السعة/النوع غير المكتمل، واستيراد البقية فقط
        </label>}
      </details>}
      {preview.unscoped&&<label style={{display:'flex',flexDirection:'row',gap:10}}>
        <input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>
        أؤكد أن أوراق المصدر التي لا تظهر فيها الكلية/القسم تخص النطاق المختار
      </label>}
      <button type="button" className="primary" disabled={loading||!canEdit||
        (preview.unscoped&&!accepted)||(unfinished&&!skipIncomplete)||
        (!preview.instructors.some(t=>!t.exists)&&!(importRooms&&roomsToCreate.length>0))}
        onClick={save}>اعتماد وحفظ المدربين والقاعات الجديدة</button>
      {unfinished&&!skipIncomplete&&<div className="alert">أكمل سعة ونوع كل قاعة جديدة، أو اختر تجاهل القاعات الناقصة.</div>}
    </div>}
    {result&&<p className="alert success">اكتمل الاستيراد: المدربون الجدد {result.importedInstructors}،
      الموجودون {result.existingInstructors}، القاعات الجديدة {result.importedRooms}،
      الموجودات {result.existingRooms}، القاعات الناقصة المتجاهلة {result.unresolvedRooms}.
      راجع الآن سجلات المدربين والقاعات في الصفحة نفسها.</p>}
  </section>;
}
