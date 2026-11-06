import {useState} from 'react';
type Issue={code:string;severity:'BLOCKER'|'WARNING';message:string;sectionId?:string;courseCode?:string};
const entries:Record<string,[string,string]>={
  SOLVER_NOT_COMPLETED:['المحرك لم يُكمل الحل','شغّل Timefold أو تحقق من سجل فشل المحرك.'],
  NO_SECTIONS:['لا توجد شعب','تحقق من بيانات الطلب والمقررات والبلوكات.'],
  UNCOVERED_SECTION:['شعبة غير مغطاة','راجع أهلية المدربين والنصاب والسعة والأوقات المتاحة.'],
  NO_ELIGIBLE_INSTRUCTOR:['لا يوجد مدرب مؤهل','راجع المقررات المؤهل لها المدرب وأنماط التدريب.'],
  LOAD_LIMIT:['النصاب غير كافٍ','راجع نصاب المدرب أو طلب استثناء معتمد للفصل.'],
  NO_FEASIBLE_TIMETABLE:['لا يوجد موعد ممكن','راجع إتاحة المدرب والقاعات والأوقات وسياسات الجدولة.'],
  SELF_PACED_NO_LOAD_POLICY:['نمط ذاتي دون سياسة نصاب','اعتمد معامل احتساب النمط الذاتي قبل الجدولة.'],
  MISSING_BLOCK:['شعبة بلا بلوك موثق','اربط الشعبة ببلوك صحيح من أفواج القسم.'],
  ROOM_CAPACITY:['سعة القاعة غير كافية','اختر قاعة ذات سعة كافية لنفس الشعبة.'],
  ROOM_INCOMPATIBLE:['نوع القاعة أو إتاحتها غير مناسب','راجع استخدام المعمل للنشاط العملي والقاعة للنظري وأوقات الإتاحة.'],
  ROOM_OCCUPIED:['القاعة مشغولة','انقل إحدى الجلستين أو اختر قاعة أخرى متاحة.'],
  TRAINER_COLLISION:['تعارض موعد المدرب','انقل إحدى الجلستين أو اختر مدربًا مؤهلًا آخر.'],
  BLOCK_COLLISION:['تعارض محاضرات البلوك','انقل جلسة حتى لا تتزامن محاضرتا الفوج نفسه.'],
  SECTION_COLLISION:['مكونات الشعبة متداخلة','افصل أوقات النظري والعملي لهذه الشعبة.'],
  TIMETABLE_COLLISION:['تعارض في الجدول','افحص المحاضرتين المشار إليهما وحدد التعديل المناسب.'],
  LOAD_EXCEEDED:['تجاوز النصاب','اخفض الإسناد أو اعتمد زيادة النصاب عبر المسار المخصص.'],
  INELIGIBLE_INSTRUCTOR:['المدرب غير مؤهل','راجع أهلية المدرب والنمط والإسناد اليدوي المثبت.'],
  COURSE_MODE_INELIGIBLE:['نمط المقرر غير معتمد','اطلب اعتماد أهلية نمط المقرر قبل تشغيل السيناريو.'],
  INSTRUCTOR_UNAVAILABLE:['المدرب غير متاح','نقل الجلسة إلى فترة متاحة أو تعديل الإتاحة باعتماد مناسب.'],
  INVALID_TIME:['موعد خارج السياسة','اختر نافذة نصف ساعة داخل الأوقات المعتمدة للفصل.'],
  DELIVERY_MODE_VIOLATION:['الموعد أو النمط غير مسموح','راجع نمط المقرر وساعات الحضوري وعن بُعد.'],
  COMPONENT_HOURS:['ساعات النظري أو العملي غير متطابقة','تحقق من تقسيم المكونات وساعات المقرر.'],
  INCOMPLETE_HOURS:['ساعات الشعبة ناقصة أو زائدة','راجع عدد جلسات الشعبة ومجموع ساعاتها.'],
  UNEXPECTED_SESSIONS:['جلسات غير متوقعة','راجع حالة الشعبة والمكونات غير المتزامنة.'],
  MISSING_BLOCK_LINK:['رابط البلوك مفقود','اربط المقرر بالبلوك الصحيح للفصل.'],
  SESSION_COHORT_MISMATCH:['اختلاف بيانات الشعبة والبلوك','راجع معرفات المقرر والشعبة والبلوك في السيناريو.'],
  UNKNOWN_SECTION:['جلسة بلا شعبة','أنشئ نسخة بيانات صحيحة قبل اعتمادها.'],
  UNKNOWN_INSTRUCTOR:['مدرب مفقود','تحقق من سجلات المدربين المرتبطة بالسيناريو.'],
  REMOTE_ROOM:['جلسة عن بُعد حجزت قاعة','أزل القاعة من الجلسة المتزامنة عن بُعد.'],
  INCONSISTENT_TOTALS:['إجماليات ساعات غير متوازنة','راجع الساعات المسندة وغير المغطاة قبل الاعتماد.']
};
export function issueText(code:string){return entries[code]??[code,'راجع السجل المرتبط وحدد سبب المانع قبل الاعتماد.'];}
export default function IssuePanel({issues,focus}:{issues:Issue[];focus:(issue:Issue)=>void}){
  const [showAll,setShowAll]=useState(false);
  const blockers=issues.filter(i=>i.severity==='BLOCKER');
  const visible=showAll?issues:issues.slice(0,25);
  return <section aria-label="تنبيهات وموانع الجاهزية">
    <div className="actions"><strong>موانع الاعتماد: {blockers.length}</strong>
      <strong>إجمالي التنبيهات: {issues.length}</strong>
      {issues.length>25&&<button onClick={()=>setShowAll(v=>!v)}>
        {showAll?'إظهار أول 25':'عرض جميع التنبيهات'}</button>}
    </div>
    {!issues.length?<p className="success">لا توجد موانع في آخر تقرير جاهزية محفوظ.</p>:
      <div className="issue-list">{visible.map((issue,index)=>{
        const [title,action]=issueText(issue.code);
        return <article key={issue.code+'-'+issue.sectionId+'-'+index}
          className={'issue-card '+(issue.severity==='BLOCKER'?'issue-blocker':'issue-warning')}>
          <strong>{issue.severity==='BLOCKER'?'مانع اعتماد':'تنبيه'}: {title}</strong>
          <p>{action}</p>
          <p className="hint">الرمز: {issue.code} · {issue.sectionId?'الشعبة '+issue.sectionId:'مستوى السيناريو'}
            {issue.courseCode?' · المقرر '+issue.courseCode:''}</p>
          <details><summary>التفاصيل الفنية</summary><p dir="auto">{issue.message}</p></details>
          {(issue.sectionId||issue.courseCode)&&<button onClick={()=>focus(issue)}>عرض السجل المرتبط في الجدول</button>}
        </article>;
      })}</div>}
  </section>;
}
