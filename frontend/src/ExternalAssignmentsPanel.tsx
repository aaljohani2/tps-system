import type {Scenario} from './api';
import {clock} from './time';
import StableBlocksPanel from './StableBlocksPanel';
import FixedGeneralStagePanel from './FixedGeneralStagePanel';

type GeneralSchedule={source:{receivedAt:string};planningAssumption:string|null;issues:Array<{code:string;message:string}>;
 locks:Array<{id:string;courseCode:string;externalSectionId:string;day:string;startMinute:number;endMinute:number;responsibleLabel:string;sourceItemId:string}>};
const dayNames:Record<string,string>={SUN:'الأحد',MON:'الاثنين',TUE:'الثلاثاء',WED:'الأربعاء',THU:'الخميس'};

export default function ExternalAssignmentsPanel({scenario}:{scenario:Scenario}){
  if((scenario.input_snapshot as {fixedGeneralStage?:unknown}|undefined)?.fixedGeneralStage)return <FixedGeneralStagePanel scenario={scenario}/>;
  if((scenario.input_snapshot as {stableBlockPlan?:unknown}|undefined)?.stableBlockPlan)return <StableBlocksPanel scenario={scenario}/>;
  const sections=scenario.result_snapshot.externalSections??[];
  if(!sections.length)return null;
  const codes=[...new Set(sections.map(section=>section.courseCode))];
  const general=(scenario.input_snapshot as {generalCourseSchedule?:GeneralSchedule}|undefined)?.generalCourseSchedule;
  return <section className="panel" aria-label="المقررات العامة بإسناد خارجي"><h3>المقررات العامة — إسناد خارجي</h3>
    <p><strong>{codes.length}</strong> مقررًا، <strong>{sections.length}</strong> شعبة بانتظار القسم الآخر؛ لا تدخل في نصاب مدربي القسم أو عجزه.</p>
    <p className="hint">{general?'المصدر نسخة مبدئية بتاريخ '+general.source.receivedAt+'؛ الربط تخطيطي مفترض بتوجيه المستخدم. الأوقات غير المكتملة والشعب الزائدة محفوظة للاستكمال.':'هذا كشف احتياج، ولم يُسند إلى مدربي القسم. يمكن تسليمه للقسم المساند واستكمال أسماء مدربيه ومواعيده لاحقًا.'}</p>
    <a href={'/api/v1/scenarios/'+scenario.id+'/external.csv'}>تنزيل كشف الإسناد الخارجي CSV</a>
    <div className="table-wrap"><table aria-label="احتياج المقررات العامة"><thead><tr><th>المقرر</th><th>المستوى</th><th>المتدربون</th><th>السعة</th><th>الشعب</th><th>التوزيع</th><th>القسم المسؤول</th><th>الحالة</th></tr></thead>
      <tbody>{codes.map(code=>{
        const groups=sections.filter(section=>section.courseCode===code),first=groups[0]!;
        return <tr key={code}><td>{first.title}<small>{code}</small></td><td>{first.level}</td>
          <td>{groups.reduce((sum,section)=>sum+section.students,0)}</td><td>{first.capacity}</td><td>{groups.length}</td>
          <td>{groups.map(section=>section.students).join('، ')}</td><td>{first.responsibleDepartment||(general?'قسم الدراسات العامة (افتراضي)':'قسم آخر — يحدد لاحقًا')}</td>
          <td>بانتظار إسناد خارجي</td></tr>;
      })}</tbody></table></div>
    {general&&<section aria-label="الأوقات المبدئية للمقررات العامة"><h4>الأوقات المبدئية المثبتة في هذه المسودة</h4>
      <p>{general.locks.length} لقاءً معلوم البداية والنهاية. المدربون الحقيقيون والقاعات الخارجية غير محددين؛ «قسم الدراسات العامة» جهة إسناد افتراضية وليس مدربًا واحدًا.</p>
      <p role="status">{general.issues.length?'الدمج جزئي؛ توجد متطلبات تحتاج استكمالًا. المسودة غير جاهزة للاعتماد.':'راجع مصدر الربط قبل الاعتماد.'}</p>
      <div className="table-wrap"><table><thead><tr><th>المقرر</th><th>الشعبة التخطيطية</th><th>اليوم</th><th>البداية</th><th>النهاية</th><th>المصدر</th></tr></thead>
        <tbody>{general.locks.map(lock=><tr key={lock.id}><td>{sections.find(s=>s.courseCode===lock.courseCode)?.title??lock.courseCode}</td><td>{lock.externalSectionId}</td>
          <td>{dayNames[lock.day]??lock.day}</td><td>{clock(lock.startMinute/60)}</td><td>{clock(lock.endMinute/60)}</td><td>{lock.sourceItemId}</td></tr>)}</tbody></table></div>
    </section>}
  </section>;
}
