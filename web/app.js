const $ = id => document.getElementById(id);
let current = null;
let active = 'sections';
const labels = {SUN:'الأحد',MON:'الاثنين',TUE:'الثلاثاء',WED:'الأربعاء',THU:'الخميس',ONSITE:'حضوري',REMOTE:'عن بُعد',HYBRID:'مدمج',SELF_PACED:'ذاتي',THEORY:'نظري',PRACTICAL:'عملي'};
const txt = value => String(value ?? '—');
function table(headers, rows){
  const el = document.createElement('table');
  const head = el.createTHead().insertRow();
  for(const h of headers){const t=document.createElement('th');t.textContent=h;head.append(t)}
  const body=el.createTBody();
  for(const row of rows){const tr=body.insertRow();for(const cell of row){const td=tr.insertCell();td.textContent=txt(cell)}}
  return el;
}
function slot(s){return `${labels[s.day]} ${String(s.start).padStart(2,'0')}:00–${String(s.end).padStart(2,'0')}:00`}
function render(){
  if(!current)return;
  const m=current.metrics;
  $('sectionCount').textContent=m.sectionCount;
  $('required').textContent=m.requiredContactHours;
  $('assigned').textContent=m.assignedContactHours;
  $('uncovered').textContent=m.uncoveredContactHours;
  $('results').hidden=false;
  $('notes').textContent=current.notices.join(' | ');
  const output=$('tab-content');output.replaceChildren();
  let t;
  if(active==='sections')t=table(['الشعبة','المقرر','المستوى','النمط','المتدربون','المدرب','الحالة'],current.sections.map(s=>[s.id,s.courseCode,s.level,labels[s.mode],s.students,s.instructorId,s.state]));
  if(active==='instructors'){
    t=table(['المدرب','النصاب الأساسي','استثناء معلن','النصاب المحتسب','الاتصال الفعلي','المتبقي'],current.instructorLoads.map(x=>[x.id,x.baseLimit,x.approvedException,x.credited,x.contact,x.remaining]));
    const detail=table(['المدرب','الشعبة','المحاضرة','نوع','الوقت'],current.sessions.map(s=>[s.instructorId,s.sectionId,s.courseCode,labels[s.component],slot(s)]));output.append(t,detail);return;
  }
  if(active==='rooms')t=table(['القاعة','الشعبة','المقرر','المكون','الوقت'],current.sessions.filter(s=>s.roomId).map(s=>[s.roomId,s.sectionId,s.courseCode,labels[s.component],slot(s)]));
  if(active==='levels')t=table(['المستوى','البلوك','الشعبة','المقرر','المكون','الوقت'],current.sessions.map(s=>[current.sections.find(x=>x.id===s.sectionId)?.level,s.blockId,s.sectionId,s.courseCode,labels[s.component],slot(s)]).sort((a,b)=>Number(a[0])-Number(b[0])));
  if(active==='gaps')t=table(['الشعبة','المقرر','المستوى','عدد المتدربين','الساعات','النصاب المكافئ','السبب'],current.gaps.map(g=>[g.sectionId,g.courseCode,g.level,g.students,g.contactHours,g.equivalentLoad,g.reason]));
  output.append(t);
}
$('file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  $('filename').textContent=file.name;
  $('payload').value=await file.text();
});
$('demo').addEventListener('click',async()=>{
  try{const r=await fetch('/example.json');if(!r.ok)throw new Error('تعذر تحميل المثال');$('payload').value=JSON.stringify(await r.json(),null,2);$('filename').textContent='مثال اصطناعي';$('error').hidden=true}catch(e){$('error').textContent=e.message;$('error').hidden=false}
});
$('run').addEventListener('click',async()=>{
  try{
    const body=$('payload').value.trim();if(!body)throw new Error('حمّل المثال أو اختر ملفًا أولًا.');
    const response=await fetch('/api/v1/plans/preview',{method:'POST',headers:{'content-type':'application/json'},body});
    const data=await response.json();if(!response.ok)throw new Error(data.error??'خطأ في التخطيط');
    current=data;active='sections';document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===active));
    $('error').hidden=true;render();
  }catch(e){$('error').textContent=e.message;$('error').hidden=false}
});
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
  active=button.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===button));render();
}));
$('export').addEventListener('click',()=>{
  if(!current)return;const blob=new Blob([JSON.stringify(current,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='tps-draft-plan.json';a.click();URL.revokeObjectURL(a.href);
});
