import {useEffect,useMemo,useState} from 'react';
import type {Plan,Scenario} from './api';

type Session=Plan['sessions'][number];
export type GridProposal={sessionId:string;day:string;start:number;nonce:number};
type Issue={code:string;severity:string;message:string;sectionId?:string;courseCode?:string};
type Input={courses:Array<{code:string;title:string;level:number}>};
const weekdays=[['SUN','الأحد'],['MON','الاثنين'],['TUE','الثلاثاء'],['WED','الأربعاء'],['THU','الخميس']] as const;
const modeLabel:Record<string,string>={ONSITE:'حضوري',REMOTE:'متزامن عن بُعد',HYBRID:'مدمج',SELF_PACED:'ذاتي'};
const clock=(v:number)=>String(Math.floor(v)).padStart(2,'0')+':'+(v%1===0.5?'30':'00');
const half=(value:number)=>Math.round(value*2)/2;
const dayOrder=(day:string)=>weekdays.findIndex(([v])=>v===day);
export default function WeeklyGrid({scenario,issues,onPropose,focusSection,canEdit:authorized}:{
 scenario:Scenario;issues:Issue[];onPropose:(m:GridProposal)=>void;focusSection?:string|null;canEdit:boolean;
}){
  const plan=scenario.result_snapshot;
  const data=scenario.input_snapshot as Input|undefined;
  const courses=new Map((data?.courses??[]).map(c=>[c.code,c]));
  const sections=new Map(plan.sections.map(s=>[s.id,s]));
  const [view,setView]=useState<'instructor'|'room'|'level'|'block'>('instructor');
  const [entity,setEntity]=useState('');
  const [focus,setFocus]=useState('');
  const [dragged,setDragged]=useState('');
  const [hint,setHint]=useState('');
  const available=useMemo(()=>({
    instructor:[...new Set(plan.sessions.map(s=>s.instructorId))].sort(),
    room:[...new Set(plan.sessions.map(s=>s.roomId).filter((v):v is string=>!!v))].sort(),
    level:[...new Set(plan.sessions.map(s=>String(sections.get(s.sectionId)?.level??'?')))].sort((a,b)=>Number(a)-Number(b)),
    block:[...new Set(plan.sessions.map(s=>s.blockId).filter((v):v is string=>!!v))].sort()
  }),[plan,sections]);
  const options=available[view],current=entity&&options.includes(entity)?entity:'';
  const groupOf=(s:Session)=>view==='instructor'?s.instructorId:
    view==='room'?s.roomId??'':view==='level'?String(sections.get(s.sectionId)?.level??'?'):s.blockId??'';
  const shown=plan.sessions.filter(s=>!current||groupOf(s)===current);
  const times=useMemo(()=>{
    const all=shown.flatMap(s=>[s.start,s.end]);
    const min=Math.min(8,...all),max=Math.max(13,...all);
    const arr:number[]=[];
    for(let h=Math.max(0,half(Math.floor(min*2)/2));h<Math.min(24,half(Math.ceil(max*2)/2));h+=.5)arr.push(h);
    return arr;
  },[shown]);
  useEffect(()=>{
    if(!focusSection)return;
    const meeting=plan.sessions.find(s=>s.sectionId===focusSection||s.courseCode===focusSection);
    if(meeting)setFocus(meeting.id);
  },[focusSection,plan]);
  const selected=plan.sessions.find(s=>s.id===focus);
  const selectedIssues=issues.filter(i=>selected&&(i.sectionId===selected.sectionId||
    (!i.sectionId&&i.courseCode===selected.courseCode)));
  const canEdit=authorized&&scenario.state==='DRAFT'&&scenario.solver_status==='COMPLETED';
  const stage=(sessionId:string,day:string,start:number)=>{
    if(!canEdit)return;
    const meeting=plan.sessions.find(s=>s.id===sessionId);
    if(!meeting)return;
    onPropose({sessionId,day,start,nonce:Date.now()});
    setFocus(sessionId);
    setHint('نُقل المقترح إلى نموذج تعديل الجلسة. لم يتم حفظ أي تغيير بعد؛ يلزم إدخال السبب واجتياز فحص Backend.');
    document.getElementById('manual-schedule-editor')?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  return <section id="weekly-grid" className="weekly-section" aria-label="شبكة الجداول الأسبوعية">
    <div className="actions"><label>نوع العرض<select value={view} onChange={e=>{setView(e.target.value as typeof view);setEntity('');}}>
      <option value="instructor">جداول المدربين</option><option value="room">جداول القاعات</option>
      <option value="level">جداول المستويات</option><option value="block">جداول البلوكات</option></select></label>
      <label>التصفية<select value={current} onChange={e=>setEntity(e.target.value)}>
        <option value="">جميع العناصر</option>{options.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
      <span className="hint">اختر أي محاضرة للتفاصيل. يمكن إسقاطها على وقت آخر لتجهيز تعديل خاضع للتحقق.</span>
    </div>
    <div className="actions" aria-label="دليل أنماط التدريب">
      <span className="session-legend onsite">حضوري</span>
      <span className="session-legend remote">عن بُعد</span>
      <span className="session-legend hybrid">مدمج</span>
    </div>
    {shown.length===0?<div className="alert">لا توجد جلسات مجدولة لهذا العرض. راجع الشعب غير المغطاة.</div>:
    <div className="table-wrap weekly-scroll"><table className="weekly-grid">
      <caption>الجدول الأسبوعي — الأوقات نصف ساعة، ويُظهر كل مربع الجلسات المتداخلة كاملة</caption>
      <thead><tr><th scope="col">الوقت</th>{weekdays.map(([day,label])=><th scope="col" key={day}>{label}</th>)}</tr></thead>
      <tbody>{times.map(t=><tr key={t}><th scope="row" dir="ltr">{clock(t)}</th>
        {weekdays.map(([day])=>{
          const starting=shown.filter(s=>s.day===day&&s.start===t).sort((a,b)=>
            dayOrder(a.day)-dayOrder(b.day)||a.start-b.start||a.courseCode.localeCompare(b.courseCode));
          const continuing=shown.filter(s=>s.day===day&&s.start<t&&s.end>t).length;
          return <td key={day} className="week-slot"
            onDragOver={e=>{if(canEdit&&dragged)e.preventDefault();}}
            onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain')||dragged;
              setDragged('');if(id)stage(id,day,t);}}
            aria-label={day+' الساعة '+clock(t)}>
            {starting.map(s=>{
              const section=sections.get(s.sectionId),course=courses.get(s.courseCode);
              const problem=issues.some(i=>i.severity==='BLOCKER'&&i.sectionId===s.sectionId);
              const css=s.mode==='REMOTE'?'remote':course?.code&&
                data?.courses.find(c=>c.code===course.code)&&
                plan.sessions.some(other=>other.sectionId===s.sectionId&&other.mode!==s.mode)?'hybrid':'onsite';
              return <button key={s.id} type="button"
                className={'week-session '+css+(problem?' flagged':'')+(focus===s.id?' focused':'')}
                draggable={canEdit} onDragStart={e=>{setDragged(s.id);e.dataTransfer.setData('text/plain',s.id);}}
                onDragEnd={()=>setDragged('')} onClick={()=>{setFocus(s.id);setHint('');}}
                aria-pressed={focus===s.id}
                title={s.courseCode+' — '+s.sectionId+' — '+clock(s.start)+' إلى '+clock(s.end)}>
                <strong>{course?.title??s.courseCode}</strong><span>{s.courseCode} · {s.sectionId}</span>
                <span>{clock(s.start)}–{clock(s.end)} · {modeLabel[s.mode]??s.mode}</span>
                <span>{s.instructorId} · {s.roomId??'بدون قاعة'} · مستوى {section?.level??'؟'}</span>
                <span>البلوك: {s.blockId??'غير محدد'}</span>{problem&&<span>تحذير: قيد إلزامي</span>}
              </button>;
            })}
            {continuing>0&&<span className="week-continuation" title="جلسات بدأت سابقًا وتستمر خلال هذا الوقت">
              {continuing} جلسة مستمرة</span>}
          </td>;
        })}</tr>)}</tbody></table></div>}
    {hint&&<div role="status" className="alert">{hint}</div>}
    {selected&&<div className="weekly-details" role="region" aria-label="تفاصيل المحاضرة المحددة">
      <h3>تفاصيل الجلسة المحددة</h3>
      <p><strong>{courses.get(selected.courseCode)?.title??selected.courseCode}</strong> —
        المقرر {selected.courseCode}، الشعبة {selected.sectionId}، المستوى {sections.get(selected.sectionId)?.level??'؟'}،
        البلوك {selected.blockId??'غير محدد'}.</p>
      <p>المدرب: {selected.instructorId} | القاعة: {selected.roomId??'عن بُعد'} |
        النمط: {modeLabel[selected.mode]??selected.mode} |
        {weekdays.find(([d])=>d===selected.day)?.[1]} {clock(selected.start)}–{clock(selected.end)}</p>
      {selectedIssues.length?<div className="alert error" role="alert">
        {selectedIssues.map((i,index)=><p key={index}>{i.code}: {i.message}</p>)}
      </div>:<p className="success">لا توجد موانع مرتبطة مباشرة بهذه الشعبة في آخر فحص.</p>}
      {canEdit&&<button onClick={()=>stage(selected.id,selected.day,selected.start)}>
        تعديل الموعد أو القاعة أو المدرب</button>}
    </div>}
  </section>;
}
