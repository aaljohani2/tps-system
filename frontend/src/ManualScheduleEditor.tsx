import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,type Plan,type Scenario} from './api';

type Input={instructors:Array<{id:string;name:string}>;rooms:Array<{id:string;name:string;type:string;capacity:number}>};
type MoveEdit={id:number;edit_version:number;session_id:string;reason:string;edited_at:string};
const names:Record<string,string>={SUN:'الأحد',MON:'الإثنين',TUE:'الثلاثاء',WED:'الأربعاء',THU:'الخميس'};
const clock=(hour:number)=>String(Math.floor(hour)).padStart(2,'0')+':'+(hour%1===0.5?'30':'00');
export default function ManualScheduleEditor({scenario,notify,proposal,canEdit:authorized}:{
  scenario:Scenario;notify:(message:string)=>void;
  proposal?:{sessionId:string;day:string;start:number;nonce:number}|null;canEdit:boolean;
}){
  const qc=useQueryClient();
  const plan=scenario.result_snapshot as Plan;
  const input=scenario.input_snapshot as Input|undefined;
  const sessions=plan.sessions;
  const [chosen,setChosen]=useState(''),[day,setDay]=useState('SUN'),[start,setStart]=useState(8),
    [room,setRoom]=useState(''),[instructor,setInstructor]=useState(''),[reason,setReason]=useState(''),
    [saving,setSaving]=useState(false);
  const history=useQuery({queryKey:['manual-edits',scenario.id],queryFn:()=>
    api<MoveEdit[]>('/scenarios/'+scenario.id+'/edits'),enabled:!!scenario.id});
  function selectSession(id:string){
    const s=sessions.find(x=>x.id===id);
    if(!s)return;
    setChosen(id);setDay(s.day);setStart(s.start);setRoom(s.roomId??'');setInstructor(s.instructorId);
  }
  useEffect(()=>{
    const s=sessions.find(x=>x.id===chosen)??sessions[0];
    if(s)selectSession(s.id);
  // Reset after a new snapshot or scenario is selected; preserves current editing in between.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scenario.id,scenario.edit_version]);
  useEffect(()=>{
    if(!proposal)return;
    const s=sessions.find(x=>x.id===proposal.sessionId);
    if(!s)return;
    setChosen(s.id);setDay(proposal.day);setStart(proposal.start);
    setRoom(s.roomId??'');setInstructor(s.instructorId);
  },[proposal?.nonce,proposal?.sessionId,proposal?.day,proposal?.start]);
  const current=sessions.find(x=>x.id===chosen);
  const editable=authorized&&scenario.state==='DRAFT'&&scenario.solver_status==='COMPLETED';
  async function save(){
    if(!current||!editable)return;
    setSaving(true);
    try{
      await api('/scenarios/'+scenario.id+'/sessions/'+encodeURIComponent(current.id),{
        method:'PATCH',body:JSON.stringify({editVersion:Number(scenario.edit_version??0),day,start,
          roomId:current.mode==='REMOTE'?null:room||null,instructorId:instructor,reason})
      });
      notify('تم نقل الجلسة والتحقق من جميع القيود وحفظ سجل التعديل.');
      setReason('');
      await qc.invalidateQueries({queryKey:['scenario',scenario.id]});
      await qc.invalidateQueries({queryKey:['readiness',scenario.id]});
      await qc.invalidateQueries({queryKey:['manual-edits',scenario.id]});
    }catch(e){
      notify('تعذر نقل الجلسة: '+String(e instanceof Error?e.message:e));
    }finally{setSaving(false);}
  }
  if(!editable)return <div className="hint">تعديل الجلسات يدويًا متاح لمسودات Timefold المكتملة فقط. الجداول المعتمدة لا تتغير؛ أنشئ مراجعة جديدة لتعديلها.</div>;
  return <details className="panel" id="manual-schedule-editor" open={!!proposal}><summary>تعديل جلسة أسبوعية مع التحقق من التعارضات</summary>
    <p className="hint">النقل اليدوي لا يعيد تشغيل Timefold، لكنه يخضع لفحص القاعات والبلوكات والأنصبة والإتاحة. تغيير المدرب ينطبق على جميع جلسات الشعبة، حفاظًا على ارتباط النظري والعملي. لا يمكن الحفظ عند وجود موانع جاهزية قائمة.</p>
    <div className="form-grid">
      <label>الجلسة<select value={chosen} onChange={e=>selectSession(e.target.value)}>
        {sessions.map(s=><option key={s.id} value={s.id}>{s.courseCode} | {s.sectionId} | {names[s.day]} {clock(s.start)}–{clock(s.end)}</option>)}
      </select></label>
      <label>اليوم<select value={day} onChange={e=>setDay(e.target.value)}>
        {Object.entries(names).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>وقت البداية (أنصاف ساعات)<input type="number" min="0" max="23.5" step=".5" value={start}
        onChange={e=>setStart(Number(e.target.value))}/></label>
      <label>المدرب<select value={instructor} onChange={e=>setInstructor(e.target.value)}>
        {(input?.instructors??[]).map(i=><option key={i.id} value={i.id}>{i.name} — {i.id}</option>)}
      </select></label>
      {current?.mode!=='REMOTE'&&<label>القاعة<select value={room} onChange={e=>setRoom(e.target.value)}>
        <option value="">اختر القاعة</option>
        {(input?.rooms??[]).map(r=><option key={r.id} value={r.id}>{r.name} ({r.type} — {r.capacity})</option>)}
      </select></label>}
      <label>سبب النقل<input value={reason} onChange={e=>setReason(e.target.value)}
        placeholder="سبب التعديل والتكليف (ثمانية أحرف على الأقل)"/></label>
    </div>
    <button className="primary" disabled={!current||saving||reason.trim().length<8||!instructor||
      (current?.mode!=='REMOTE'&&!room)} onClick={save}>حفظ النقل بعد فحص التعارضات</button>
    <h3>سجل التعديلات اليدوية</h3>
    <div className="table-wrap"><table><thead><tr><th>الإصدار</th><th>الجلسة</th><th>السبب</th><th>التاريخ</th></tr></thead>
      <tbody>{(history.data??[]).map(x=><tr key={x.id}><td>{x.edit_version}</td><td>{x.session_id}</td>
        <td>{x.reason}</td><td>{new Date(x.edited_at).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}</td></tr>)}</tbody>
    </table></div>
  </details>;
}
