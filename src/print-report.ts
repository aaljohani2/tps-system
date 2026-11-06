import type {PlanResult} from './types.js';
import type {ReadinessIssue} from './api/readiness.js';

const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]??ch));
const stateLabel=(state:string)=>({
  APPROVED:'معتمد داخليًا',UNDER_REVIEW:'تحت المراجعة',DRAFT:'مسودة',
  REJECTED:'مرفوض',ARCHIVED:'مؤرشف'} as Record<string,string>)[state]??state;
const summary=(a:string,b:unknown)=>'<tr><th>'+escapeHtml(a)+'</th><td>'+escapeHtml(b)+'</td></tr>';
export function renderPrintableScenario(args:{
  name:string;state:string;termId:string;policyRevision:number;
  result:PlanResult;issues:ReadinessIssue[]
}):string{
  const {name,state,termId,policyRevision,result,issues}=args;
  const counts=result.metrics;
  const rows=[
    ['حالة السيناريو',stateLabel(state)],['اسم السيناريو',name],
    ['معرّف الفصل التدريبي',termId],['إصدار السياسة',policyRevision],
    ['إجمالي الشعب',counts.sectionCount],['الشعب غير المغطاة',counts.uncoveredSectionCount],
    ['الساعات المطلوبة',counts.requiredContactHours],
    ['الساعات المسندة',counts.assignedContactHours],
    ['الساعات غير المغطاة',counts.uncoveredContactHours],
    ['عدد موانع الجاهزية',issues.filter(i=>i.severity==='BLOCKER').length]
  ];
  const gaps=result.gaps.map(g=>'<tr>'+
    [g.courseCode,g.sectionId,g.level,g.students,g.contactHours,g.equivalentLoad,g.reason]
      .map(value=>'<td>'+escapeHtml(value)+'</td>').join('')+'</tr>').join('');
  const diagnostics=issues.map(i=>'<tr>'+
    [i.code,i.severity,i.courseCode??'—',i.sectionId??'—',i.message]
      .map(value=>'<td>'+escapeHtml(value)+'</td>').join('')+'</tr>').join('');
  const load=result.instructorLoads.map(i=>'<tr>'+
    [i.id,i.baseLimit,i.approvedException,i.credited,i.contact,i.remaining]
      .map(value=>'<td>'+escapeHtml(value)+'</td>').join('')+'</tr>').join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>تقرير TPS — ${escapeHtml(name)}</title>
  <style>
  body{font-family:Tahoma,"Segoe UI",Arial,sans-serif;color:#223b43;padding:32px;line-height:1.5}
  h1{color:#165d61}h2{font-size:1.12rem;margin-top:32px;color:#17676a}
  table{width:100%;border-collapse:collapse;table-layout:auto;margin-top:10px;font-size:11pt}
  th,td{padding:9px;border:1px solid #b9cdd1;text-align:right;vertical-align:top;overflow-wrap:anywhere}
  th{background:#eaf3f4}button{padding:10px 20px;background:#17676a;color:white;border:none;border-radius:6px}
  .status{font-weight:bold}.disclaimer{border:1px solid #b5bec3;padding:12px;background:#f6f8f8}
  footer{font-size:9pt;color:#536970;margin-top:40px}
  @page{size:A4 landscape;margin:13mm}
  @media print{button{display:none}body{padding:0}table{font-size:9pt}tr{break-inside:avoid}
    h2{break-after:avoid}}
  </style></head><body><button type="button" onclick="window.print()">طباعة أو حفظ PDF</button>
  <h1>تقرير جدولة التدريب — TPS</h1>
  <p class="disclaimer">نسخة تخطيطية محلية من بيانات السيناريو المحفوظ في PostgreSQL.
    حالة اعتماد TPS داخلية ولا تمثل اعتمادًا مؤسسيًا أو رفعًا إلى رايات.</p>
  <h2>ملخص السيناريو</h2><table><tbody>${rows.map(([a,b])=>summary(String(a),b)).join('')}</tbody></table>
  <h2>كشف العجز (${result.gaps.length})</h2>
  <table><thead><tr><th>المقرر</th><th>الشعبة</th><th>المستوى</th><th>المتدربون</th>
    <th>ساعات الاتصال</th><th>النصاب المكافئ</th><th>السبب</th></tr></thead>
    <tbody>${gaps||'<tr><td colspan="7">لا يوجد عجز مسجل.</td></tr>'}</tbody></table>
  <h2>موانع الجاهزية والتعارضات (${issues.length})</h2>
  <table><thead><tr><th>الرمز</th><th>الخطورة</th><th>المقرر</th><th>الشعبة</th><th>التفاصيل</th></tr></thead>
    <tbody>${diagnostics||'<tr><td colspan="5">لا توجد موانع مسجلة.</td></tr>'}</tbody></table>
  <h2>أنصبة المدربين</h2><table><thead><tr><th>المدرب</th><th>النصاب الأساسي</th><th>الاستثناء المعتمد</th>
    <th>المكافئ</th><th>الاتصال</th><th>المتبقي</th></tr></thead>
    <tbody>${load||'<tr><td colspan="6">لا توجد أنصبة.</td></tr>'}</tbody></table>
  <footer>هذا المستند قابل للطباعة إلى PDF من المتصفح المحلي؛ لم يُرسل أي محتوى إلى خدمة خارجية.</footer>
  </body></html>`;
}
