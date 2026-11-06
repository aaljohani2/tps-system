import {useEffect,useState} from 'react';
import {Link,NavLink,Navigate,Route,Routes} from 'react-router-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,post,setCSRF,type Auth,type Context,type Entity,type Plan,type Scenario} from './api';
import PolicyPage from './PolicyPage';
import ResourcesEditor from './ResourcesEditor';

const labels:Record<string,string>={ONSITE:'حضوري',REMOTE:'عن بُعد',SELF_PACED:'ذاتي',HYBRID:'مدمج'};
const days:Record<string,string>={SUN:'الأحد',MON:'الإثنين',TUE:'الثلاثاء',WED:'الأربعاء',THU:'الخميس'};
type Message=(s:string)=>void;
function useStore<T>(key:string,initial:T):[T,(v:T)=>void]{
  const [value,set]=useState<T>(()=>{try{return JSON.parse(localStorage.getItem(key)??'null')??initial;}catch{return initial;}});
  return [value,v=>{set(v);localStorage.setItem(key,JSON.stringify(v));}];
}
function Login({onLogin}:{onLogin:(auth:Auth)=>void}){
  const [username,setUser]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');
  async function submit(e:React.FormEvent){e.preventDefault();setError('');try{
    await post('/auth/login',{username,password});
    const user=await api<Auth>('/auth/me');setCSRF(user.csrfToken);onLogin(user);
  }catch(e){setError(String(e instanceof Error?e.message:e));}}
  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <span className="brand-mark">TPS</span><h1>نظام تخطيط وجدولة التدريب</h1>
    <p>تسجيل الدخول إلى بيئة التخطيط المحلية</p><label>اسم المستخدم<input autoComplete="username" value={username} onChange={e=>setUser(e.target.value)} required/></label>
    <label>كلمة المرور<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
    {error&&<div role="alert" className="alert error">{error}</div>}<button className="primary">دخول النظام</button>
    <small>البيانات محلية — لا يوجد اتصال أو نشر في رايات</small>
  </form></main>;
}
function Select({label,items,value,onChange,placeholder='اختر'}:{label:string;items:Entity[];value:string;onChange:(v:string)=>void;placeholder?:string}){
  return <label>{label}<select value={value} onChange={e=>onChange(e.target.value)}><option value="">{placeholder}</option>
  {items.map(i=><option key={i.id} value={i.id}>{i.name??i.label??i.code??i.id}</option>)}</select></label>;
}
function ContextSetup({context,setContext,notify}:{context:Context;setContext:(c:Context)=>void;notify:Message}){
  const qc=useQueryClient();
  const colleges=useQuery({queryKey:['colleges'],queryFn:()=>api<Entity[]>('/colleges')});
  const departments=useQuery({queryKey:['departments',context.collegeId],queryFn:()=>api<Entity[]>('/departments?collegeId='+context.collegeId),enabled:!!context.collegeId});
  const terms=useQuery({queryKey:['terms',context.collegeId],queryFn:()=>api<Entity[]>('/terms?collegeId='+context.collegeId),enabled:!!context.collegeId});
  const [newInstitution,setInstitution]=useState(''),[newCollege,setCollege]=useState(''),[newDept,setDept]=useState(''),
    [newTerm,setTerm]=useState(''),[termStart,setTermStart]=useState(''),[termEnd,setTermEnd]=useState('');
  const institutions=useQuery({queryKey:['institutions'],queryFn:()=>api<Entity[]>('/institutions')});
  const [institutionId,setInstitutionId]=useState('');
  async function run(task:()=>Promise<unknown>){try{await task();notify('تم الحفظ بنجاح');await qc.invalidateQueries();}catch(e){notify('تعذر الحفظ: '+String(e instanceof Error?e.message:e));}}
  return <section className="panel">
    <h2>١. اختيار الكلية والقسم والفصل</h2><p className="hint">لن تُولّد الجداول قبل تحديد النطاق الأكاديمي. الخيارات المحفوظة تخص هذا المتصفح فقط.</p>
    <div className="form-grid">
      <Select label="الكلية" items={colleges.data??[]} value={context.collegeId} onChange={collegeId=>setContext({collegeId,departmentId:'',termId:''})}/>
      <Select label="القسم" items={departments.data??[]} value={context.departmentId} onChange={departmentId=>setContext({...context,departmentId})}/>
      <Select label="الفصل التدريبي" items={terms.data??[]} value={context.termId} onChange={termId=>setContext({...context,termId})}/>
    </div>
    <details><summary>تهيئة بيانات الكلية والقسم والفصل (للمخولين)</summary>
      <div className="form-grid">
        <label>إضافة مؤسسة<input placeholder="اسم المؤسسة" value={newInstitution} onChange={e=>setInstitution(e.target.value)}/></label>
        <button onClick={()=>run(()=>post('/institutions',{name:newInstitution}))}>إنشاء المؤسسة</button>
        <Select label="المؤسسة" items={institutions.data??[]} value={institutionId} onChange={setInstitutionId}/>
        <label>اسم الكلية<input value={newCollege} onChange={e=>setCollege(e.target.value)}/></label>
        <button onClick={()=>run(()=>post('/colleges',{institutionId,name:newCollege}))}>إنشاء الكلية</button>
        <label>القسم الجديد<input value={newDept} onChange={e=>setDept(e.target.value)}/></label>
        <button disabled={!context.collegeId} onClick={()=>run(()=>post('/departments',{collegeId:context.collegeId,name:newDept}))}>إنشاء القسم</button>
        <label>رمز الفصل<input value={newTerm} onChange={e=>setTerm(e.target.value)}/></label>
        <label>تاريخ البداية<input type="date" value={termStart} onChange={e=>setTermStart(e.target.value)}/></label>
        <label>تاريخ النهاية<input type="date" value={termEnd} onChange={e=>setTermEnd(e.target.value)}/></label>
        <button disabled={!context.collegeId} onClick={()=>run(()=>post('/terms',{collegeId:context.collegeId,code:newTerm,label:newTerm,startsOn:termStart,endsOn:termEnd}))}>إنشاء الفصل</button>
      </div>
    </details>
  </section>;
}
function CoursePage({ctx,notify}:{ctx:Context;notify:Message}){
  const qc=useQueryClient(),q=useQuery({queryKey:['courses',ctx.departmentId],queryFn:()=>api<Entity[]>('/courses?departmentId='+ctx.departmentId),enabled:!!ctx.departmentId});
  const [csv,setCsv]=useState(''),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<{courses:Entity[];warnings:string[];ignored:unknown[]}|null>(null);
  const [code,setCode]=useState(''),[title,setTitle]=useState(''),[level,setLevel]=useState(1),[theory,setTheory]=useState(2),[practical,setPractical]=useState(0);
  async function run(task:()=>Promise<unknown>){try{await task();notify('تم حفظ البيانات');await qc.invalidateQueries();}catch(e){notify('فشل: '+String(e instanceof Error?e.message:e));}}
  async function pick(e:React.ChangeEvent<HTMLInputElement>){
    const f=e.target.files?.[0];if(!f)return;
    if(!/\.(csv|xlsx)$/i.test(f.name)){notify('الصيغ المقبولة CSV وXLSX');return;}
    setFile(f);setCsv(f.name.toLowerCase().endsWith('.csv')?await f.text():'');setPreview(null);
  }
  return <section className="panel">
    <h2>٢. استيراد وإدارة المقررات</h2>
    <p className="hint">ارفع Excel أو CSV للخطة، وعاين المقررات والأخطاء قبل التأكيد. يحتفظ النظام بالطلب السابق عند تحديث مقررات موجودة.</p>
    <div className="actions"><a href="/api/v1/import/courses/template.csv">قالب CSV</a>
      <a href="/api/v1/import/courses/template.xlsx">قالب Excel</a>
      <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={pick}/>
      <button disabled={!file||!ctx.departmentId} onClick={()=>run(async()=>{
        const xlsx=file!.name.toLowerCase().endsWith('.xlsx');
        if(xlsx)setPreview(await api<{courses:Entity[];warnings:string[];ignored:unknown[]}>(
          '/import/courses/preview-xlsx?departmentId='+ctx.departmentId,
          {method:'POST',body:file!,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}}));
        else setPreview(await post('/import/courses/preview',{departmentId:ctx.departmentId,csv}));
      })}>معاينة</button>
      <button className="primary" disabled={!preview} onClick={()=>run(async()=>{
        const xlsx=file!.name.toLowerCase().endsWith('.xlsx');
        if(xlsx)await api('/import/courses/commit-xlsx?departmentId='+ctx.departmentId,
          {method:'POST',body:file!,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
        else await post('/import/courses/commit',{departmentId:ctx.departmentId,csv});
        setPreview(null);
      })}>اعتماد الاستيراد</button>
    </div>
    {preview&&<div className="alert">الصفوف المقبولة: {preview.courses.length}، المستبعدة: {preview.ignored.length}. {preview.warnings.join(' | ')}</div>}
    <details><summary>إضافة مقرر يدويًا</summary>
      <div className="form-grid">
        <label>رمز المقرر<input value={code} onChange={e=>setCode(e.target.value)}/></label>
        <label>اسم المقرر<input value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <label>المستوى<input type="number" min="1" max="12" value={level} onChange={e=>setLevel(+e.target.value)}/></label>
        <label>النظري<input type="number" min="0" value={theory} onChange={e=>setTheory(+e.target.value)}/></label>
        <label>العملي<input type="number" min="0" value={practical} onChange={e=>setPractical(+e.target.value)}/></label>
        <button onClick={()=>run(()=>post('/courses',{departmentId:ctx.departmentId,code,title,level,theoryHours:theory,practicalHours:practical,demand:0}))}>إضافة المقرر</button>
      </div></details>
    <div className="table-wrap"><table><thead><tr><th>المقرر</th><th>المستوى</th><th>النظري</th><th>العملي</th><th>الطلب</th><th>البلوكات</th><th>النمط</th><th></th></tr></thead>
    <tbody>{(q.data??[]).map(c=><CourseRow key={c.id} item={c} save={data=>run(()=>api('/courses/'+c.id,{method:'PATCH',body:JSON.stringify(data)}))}/>)}</tbody></table></div>
  </section>;
}
function CourseRow({item,save}:{item:Entity;save:(d:unknown)=>void}){
  const [demand,setDemand]=useState(Number(item.demand??0)),[blocks,setBlocks]=useState((item.blocks as string[]|undefined)?.join(',')??'');
  const [mode,setMode]=useState(String(item.mode??'ONSITE'));
  return <tr><td><strong>{String(item.title)}</strong><small>{item.code}</small></td><td>{String(item.level)}</td>
    <td>{String(item.theoryHours)}</td><td>{String(item.practicalHours)}</td>
    <td><input className="small" type="number" min="0" value={demand} onChange={e=>setDemand(+e.target.value)}/></td>
    <td><input className="medium" placeholder="BLK-1,BLK-2..." value={blocks} onChange={e=>setBlocks(e.target.value)}/></td>
    <td><select value={mode} onChange={e=>setMode(e.target.value)}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></td>
    <td><button onClick={()=>save({demand,blocks:blocks.split(',').map(x=>x.trim()).filter(Boolean),mode,eligibleModes:[mode]})}>حفظ</button></td>
  </tr>;
}
function ResourcesPage({ctx,notify}:{ctx:Context;notify:Message}){
  const qc=useQueryClient();
  const inst=useQuery({queryKey:['instructors',ctx.departmentId],queryFn:()=>api<Entity[]>('/instructors?departmentId='+ctx.departmentId),enabled:!!ctx.departmentId});
  const rooms=useQuery({queryKey:['rooms',ctx.collegeId],queryFn:()=>api<Entity[]>('/rooms?collegeId='+ctx.collegeId),enabled:!!ctx.collegeId});
  const [i,setI]=useState({code:'',name:'',maxLoad:18,eligibleCourseCodes:''});
  const [r,setR]=useState({code:'',name:'',capacity:30,type:'CLASSROOM',building:''});
  async function run(task:()=>Promise<unknown>){try{await task();notify('حُفظ السجل');await qc.invalidateQueries();}catch(e){notify('تعذر الحفظ: '+String(e instanceof Error?e.message:e));}}
  return <section className="panel">
    <h2>٣. المدربون والقاعات</h2><div className="split">
    <section><h3>المدربون والأنصبة</h3><div className="form-grid">
      <label>الرمز<input value={i.code} onChange={e=>setI({...i,code:e.target.value})}/></label>
      <label>الاسم<input value={i.name} onChange={e=>setI({...i,name:e.target.value})}/></label>
      <label>النصاب المكافئ<input type="number" value={i.maxLoad} onChange={e=>setI({...i,maxLoad:+e.target.value})}/></label>
      <label>المقررات المؤهل لها (رموز مفصولة بفواصل)<input value={i.eligibleCourseCodes} onChange={e=>setI({...i,eligibleCourseCodes:e.target.value})}/></label>
    </div><button className="primary" onClick={()=>run(()=>post('/instructors',{departmentId:ctx.departmentId,
      code:i.code,name:i.name,maxLoad:i.maxLoad,...(i.eligibleCourseCodes.trim()?{eligibleCourseCodes:i.eligibleCourseCodes.split(',').map(v=>v.trim()).filter(Boolean)}:{})}))}>إضافة مدرب</button>
      <div className="table-wrap"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>النصاب</th></tr></thead><tbody>
      {(inst.data??[]).map(x=><tr key={x.id}><td>{String(x.code)}</td><td>{String(x.name)}</td><td>{String(x.maxLoad)}</td></tr>)}</tbody></table></div>
    </section><section><h3>القاعات والمعامل</h3><div className="form-grid">
      <label>رمز القاعة<input value={r.code} onChange={e=>setR({...r,code:e.target.value})}/></label>
      <label>اسم القاعة<input value={r.name} onChange={e=>setR({...r,name:e.target.value})}/></label>
      <label>السعة<input type="number" value={r.capacity} onChange={e=>setR({...r,capacity:+e.target.value})}/></label>
      <label>نوع القاعة<select value={r.type} onChange={e=>setR({...r,type:e.target.value})}><option value="CLASSROOM">قاعة نظرية</option><option value="LAB">معمل</option><option value="MULTI">متعددة</option></select></label>
      <label>المبنى<input value={r.building} onChange={e=>setR({...r,building:e.target.value})}/></label>
    </div><button className="primary" onClick={()=>run(()=>post('/rooms',{collegeId:ctx.collegeId,...r}))}>إضافة قاعة</button>
      <div className="table-wrap"><table><thead><tr><th>القاعة</th><th>النوع</th><th>السعة</th></tr></thead><tbody>
      {(rooms.data??[]).map(x=><tr key={x.id}><td>{String(x.code)}</td><td>{String(x.type)}</td><td>{String(x.capacity)}</td></tr>)}</tbody></table></div>
    </section></div>
  </section>;
}
function Metrics({p}:{p:Plan}){
  return <div className="metrics"><article><span>إجمالي الشعب</span><strong>{p.metrics.sectionCount}</strong></article>
    <article><span>الساعات المطلوبة</span><strong>{p.metrics.requiredContactHours}</strong></article>
    <article><span>الساعات المغطاة</span><strong>{p.metrics.assignedContactHours}</strong></article>
    <article className={p.metrics.uncoveredSectionCount?'danger':''}><span>الشعب غير المغطاة</span><strong>{p.metrics.uncoveredSectionCount}</strong></article></div>;
}
function Timetable({p}:{p:Plan}){
  const [mode,setMode]=useState('instructors'),[filter,setFilter]=useState('');
  const key=mode==='instructors'?'instructorId':mode==='rooms'?'roomId':mode==='blocks'?'blockId':'courseCode';
  const options=Array.from(new Set(p.sessions.map(s=>String(s[key as keyof typeof s]??'غير محدد'))));
  const shown=p.sessions.filter(s=>!filter||String(s[key as keyof typeof s]??'غير محدد')===filter);
  return <div><div className="actions">
    <select value={mode} onChange={e=>{setMode(e.target.value);setFilter('');}}><option value="instructors">جداول المدربين</option>
    <option value="rooms">جداول القاعات</option><option value="blocks">البلوكات</option><option value="courses">المقررات</option></select>
    <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">الكل</option>
      {options.map(o=><option key={o} value={o}>{o}</option>)}</select>
  </div><div className="table-wrap"><table><thead><tr><th>اليوم</th><th>الوقت</th><th>المقرر/الشعبة</th><th>المدرب</th><th>القاعة</th><th>النمط</th><th>البلوك</th></tr></thead>
    <tbody>{[...shown].sort((a,b)=>['SUN','MON','TUE','WED','THU'].indexOf(a.day)-['SUN','MON','TUE','WED','THU'].indexOf(b.day)||a.start-b.start)
      .map(s=><tr key={s.id}><td>{days[s.day]}</td><td dir="ltr">{s.start}:00 — {s.end}:00</td><td>{s.courseCode}<small>{s.sectionId}</small></td>
      <td>{s.instructorId}</td><td>{s.roomId??'عن بُعد'}</td><td><span className="tag">{labels[s.mode]}</span></td><td>{s.blockId??'غير محدد'}</td></tr>)}</tbody></table></div>
  </div>;
}
function ScenarioPage({ctx,notify}:{ctx:Context;notify:Message}){
  const qc=useQueryClient(),list=useQuery({queryKey:['scenarios',ctx.departmentId,ctx.termId],
    queryFn:()=>api<Scenario[]>('/scenarios?departmentId='+ctx.departmentId+'&termId='+ctx.termId),enabled:!!ctx.departmentId&&!!ctx.termId});
  const [name,setName]=useState('السيناريو الحضوري'),[selected,setSelected]=useState(''),[working,setWorking]=useState(false),[second,setSecond]=useState('');
  const [forkName,setForkName]=useState('سيناريو بديل'),[forkDemand,setForkDemand]=useState<Record<string,number>>({}),
    [forkBlocks,setForkBlocks]=useState<Record<string,string>>({});
  const one=useQuery({queryKey:['scenario',selected],queryFn:()=>api<Scenario>('/scenarios/'+selected),enabled:!!selected});
  const comparison=useQuery({queryKey:['comparison',selected,second],
    queryFn:()=>api<{first:Record<string,unknown>;second:Record<string,unknown>}>('/scenarios/compare?ids='+selected+','+second),enabled:!!selected&&!!second});
  async function run(job:()=>Promise<unknown>){
    setWorking(true);try{const r=await job();notify('اكتملت العملية');await qc.invalidateQueries();return r;}
    catch(e){notify('العملية لم تكتمل: '+String(e instanceof Error?e.message:e));}
    finally{setWorking(false);}
  }
  useEffect(()=>{
    const input=one.data?.input_snapshot as {courses?:Array<{code:string;demand:number;blocks?:string[]}>}|undefined;
    if(!input?.courses)return;
    setForkName(one.data!.name+' — بديل');
    setForkDemand(Object.fromEntries(input.courses.map(c=>[c.code,c.demand])));
    setForkBlocks(Object.fromEntries(input.courses.map(c=>[c.code,c.blocks?.join(',')??''])));
  },[selected,one.data]);
  const rows=list.data??[],current=one.data,p=current?.result_snapshot;
  const originalCourses=((current?.input_snapshot as {courses?:Array<{code:string;title:string;demand:number;blocks?:string[]}>}|undefined)?.courses??[]);
  return <section className="panel"><h2>٥. إنشاء الشعب وتشغيل Timefold</h2>
    <p className="hint">إنشاء السيناريو يحسب مسودة Greedy مع إظهار العجز. زر Timefold وحده ينفذ التحسين؛ لا يُخفى تعطل Java.</p>
    <div className="actions"><input placeholder="اسم السيناريو" value={name} onChange={e=>setName(e.target.value)}/>
      <button className="primary" disabled={working||!ctx.termId} onClick={()=>run(async()=>{
        const s=await post<{id:string}>('/scenarios',{departmentId:ctx.departmentId,termId:ctx.termId,name});setSelected(s.id);
      })}>إنشاء السيناريو والشعب</button></div>
    <div className="actions"><Select label="السيناريو الحالي" items={rows.map(s=>({id:s.id,name:s.name+' — '+s.state+' / '+s.solver_status}))}
      value={selected} onChange={setSelected}/></div>
    {current&&p&&<><div className="actions"><span className="status">الحالة: {current.state} — المحرك: {current.solver_status}</span>
      <button disabled={working||current.state!=='DRAFT'} onClick={()=>run(()=>post('/scenarios/'+selected+'/solve',{}))}>تشغيل Timefold</button>
      <button disabled={working||current.state!=='DRAFT'||current.solver_status!=='COMPLETED'} onClick={()=>run(()=>post('/scenarios/'+selected+'/review',{}))}>إرسال للمراجعة</button>
      <button disabled={working||current.state!=='UNDER_REVIEW'} onClick={()=>run(()=>post('/scenarios/'+selected+'/approve',{}))}>اعتماد السيناريو</button>
      <button disabled={working} onClick={()=>run(async()=>{const s=await post<{id:string}>('/scenarios/'+selected+'/revise',{});setSelected(s.id);})}>إنشاء مراجعة جديدة</button>
      <a href={'/api/v1/scenarios/'+selected+'/export.csv'} target="_blank" rel="noreferrer">تصدير CSV</a>
      <a href={'/api/v1/scenarios/'+selected+'/export.xlsx'} target="_blank" rel="noreferrer">تصدير Excel</a></div>
      <Metrics p={p}/><div className="subhead"><h3>الجداول الأسبوعية</h3></div><Timetable p={p}/>
      <h3>كشف العجز</h3>{p.gaps.length?<div className="table-wrap"><table><thead><tr><th>الشعبة</th><th>المقرر</th><th>السبب</th><th>ساعات التدريب</th><th>النصاب المطلوب</th></tr></thead>
        <tbody>{p.gaps.map(g=><tr key={g.sectionId}><td>{g.sectionId}</td><td>{g.courseCode}</td><td>{g.reason}</td><td>{g.contactHours}</td><td>{g.equivalentLoad}</td></tr>)}</tbody></table></div>:<p className="success">لا يوجد عجز مسجل في النتيجة الحالية. يلزم التحقق من هوية البلوكات قبل اعتمادها.</p>}
      <h3>أنصبة المدربين</h3><div className="table-wrap"><table><thead><tr><th>المدرب</th><th>الساعات الفعلية</th><th>النصاب المكافئ</th><th>المتبقي</th></tr></thead><tbody>
        {p.instructorLoads.map(i=><tr key={i.id}><td>{i.id}</td><td>{i.contact}</td><td>{i.credited}</td><td>{i.remaining}</td></tr>)}</tbody></table></div>
      {p.notices.length>0&&<div className="alert">{p.notices.join(' | ')}</div>}
      <details><summary>إنشاء سيناريو بديل مستقل من هذا السيناريو</summary>
        <p className="hint">غيّر الطلب المتوقع أو البلوكات هنا دون تعديل المقررات الرئيسية أو السيناريو الأصلي. يجب إعادة تشغيل Timefold للبديل؛ ولا تعني هذه العملية اعتماد الجدول.</p>
        <label>اسم السيناريو البديل<input value={forkName} onChange={e=>setForkName(e.target.value)}/></label>
        <div className="table-wrap"><table><thead><tr><th>المقرر</th><th>الطلب المتوقع</th><th>بلوكات الفوج (فاصلة بين كل بلوك)</th></tr></thead><tbody>
        {originalCourses.map(c=><tr key={c.code}><td>{c.title}<small>{c.code}</small></td>
          <td><input type="number" min="0" max="5000" value={forkDemand[c.code]??c.demand}
            onChange={e=>setForkDemand(v=>({...v,[c.code]:Number(e.target.value)}))}/></td>
          <td><input className="medium" value={forkBlocks[c.code]??''}
            onChange={e=>setForkBlocks(v=>({...v,[c.code]:e.target.value}))}/></td></tr>)}
        </tbody></table></div>
        <button className="primary" disabled={working||!forkName.trim()} onClick={()=>run(async()=>{
          const sourceId=selected;
          const fork=await post<{id:string}>('/scenarios/'+sourceId+'/fork',{name:forkName,
            overrides:originalCourses.map(c=>({code:c.code,demand:forkDemand[c.code]??c.demand,
              blocks:(forkBlocks[c.code]??'').split(',').map(x=>x.trim()).filter(Boolean)}))});
          setSelected(fork.id);setSecond(sourceId);
        })}>إنشاء البديل ومقارنته بالأصل</button>
      </details>
      <div className="compare"><h3>مقارنة السيناريوهات</h3><Select label="السيناريو الثاني" items={rows.filter(s=>s.id!==selected).map(s=>({id:s.id,name:s.name}))}
        value={second} onChange={setSecond}/>
        {comparison.data&&<div className="table-wrap"><table><thead><tr><th>المؤشر</th><th>الحالي</th><th>المقارن</th></tr></thead><tbody>
        {['sections','requiredHours','coveredHours','uncovered','coverage','load','state','solver'].map(k=><tr key={k}><td>{k}</td><td>{String(comparison.data!.first[k])}</td><td>{String(comparison.data!.second[k])}</td></tr>)}</tbody></table></div>}
      </div>
    </>}
  </section>;
}
const nav=[['/context','الكلية والقسم والفصل'],['/courses','المقررات والطلب'],['/resources','المدربون والقاعات'],['/policy','الأنماط والأنصبة'],['/scheduling','الشعب والجدولة والاعتماد']];
export default function App(){
  const qc=useQueryClient(),[user,setUser]=useState<Auth|null>(null),[initial,setInitial]=useState(true);
  const [ctx,setCtx]=useStore<Context>('tps-context',{collegeId:'',departmentId:'',termId:''});
  const [message,notify]=useState('');
  useEffect(()=>{api<Auth>('/auth/me').then(v=>{setCSRF(v.csrfToken);setUser(v);}).catch(()=>{}).finally(()=>setInitial(false));},[]);
  if(initial)return <main className="loading">جاري التحقق من الجلسة المحلية...</main>;
  if(!user)return <Login onLogin={setUser}/>;
  const doLogout=async()=>{await post('/auth/logout',{});setCSRF('');setUser(null);await qc.clear();};
  return <div className="shell"><aside className="sidebar"><div className="brand"><strong>TPS</strong><small>تخطيط وجدولة التدريب</small></div>
    <nav>{nav.map(([to,label],idx)=><NavLink key={to} to={to} className={({isActive})=>isActive?'active':''}>
      <span className="step">{idx+1}</span>{label}</NavLink>)}</nav>
    <div className="sidebar-footer"><span>{user.username}</span><small>{user.role}</small><button onClick={doLogout}>تسجيل الخروج</button></div>
  </aside><main className="content"><header className="top"><div><small>بيئة تطوير محلية — TPS V1</small>
    <h1>إدارة الجداول التدريبية</h1></div><span className="badge">مسودات محلية، دون تكامل رايات</span></header>
    {message&&<div className="toast" role="status" onClick={()=>notify('')}>{message} <button aria-label="إغلاق">×</button></div>}
    <Routes><Route path="/" element={<Navigate to="/context" replace/>}/>
    <Route path="/context" element={<ContextSetup context={ctx} setContext={setCtx} notify={notify}/>}/>
    <Route path="/courses" element={ctx.departmentId?<CoursePage ctx={ctx} notify={notify}/>:<NeedContext/>}/>
    <Route path="/resources" element={ctx.departmentId?<ResourcesEditor ctx={ctx} user={user} notify={notify}/>:<NeedContext/>}/>
    <Route path="/policy" element={ctx.termId&&ctx.departmentId?<PolicyPage ctx={ctx} user={user} notify={notify}/>:<NeedContext/>}/>
    <Route path="/scheduling" element={ctx.termId&&ctx.departmentId?<ScenarioPage ctx={ctx} notify={notify}/>:<NeedContext/>}/>
    <Route path="*" element={<Navigate to="/context"/>}/></Routes>
    <footer>محرك Timefold لتوليد الجداول · البيانات محفوظة في PostgreSQL المحلي · الأوقات بتوقيت السعودية</footer>
  </main></div>;
}
function NeedContext(){return <section className="panel"><h2>النطاق غير مكتمل</h2><p>اختر الكلية والقسم والفصل التدريبي قبل هذه الخطوة.</p><Link to="/context">العودة لاختيار النطاق</Link></section>;}
