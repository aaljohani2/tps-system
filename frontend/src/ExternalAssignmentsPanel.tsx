import type {Scenario} from './api';

export default function ExternalAssignmentsPanel({scenario}:{scenario:Scenario}){
  const sections=scenario.result_snapshot.externalSections??[];
  if(!sections.length)return null;
  const codes=[...new Set(sections.map(section=>section.courseCode))];
  return <section className="panel" aria-label="المقررات العامة بإسناد خارجي"><h3>المقررات العامة — إسناد خارجي</h3>
    <p><strong>{codes.length}</strong> مقررًا، <strong>{sections.length}</strong> شعبة بانتظار القسم الآخر؛ لا تدخل في نصاب مدربي القسم أو عجزه.</p>
    <p className="hint">هذا كشف احتياج، ولم يُسند إلى مدربي القسم. يمكن تسليمه للقسم المساند واستكمال أسماء مدربيه ومواعيده لاحقًا.</p>
    <a href={'/api/v1/scenarios/'+scenario.id+'/external.csv'}>تنزيل كشف الإسناد الخارجي CSV</a>
    <div className="table-wrap"><table><thead><tr><th>المقرر</th><th>المستوى</th><th>المتدربون</th><th>السعة</th><th>الشعب</th><th>التوزيع</th><th>القسم المسؤول</th><th>الحالة</th></tr></thead>
      <tbody>{codes.map(code=>{
        const groups=sections.filter(section=>section.courseCode===code),first=groups[0]!;
        return <tr key={code}><td>{first.title}<small>{code}</small></td><td>{first.level}</td>
          <td>{groups.reduce((sum,section)=>sum+section.students,0)}</td><td>{first.capacity}</td><td>{groups.length}</td>
          <td>{groups.map(section=>section.students).join('، ')}</td><td>{first.responsibleDepartment||'قسم آخر — يحدد لاحقًا'}</td>
          <td>بانتظار إسناد خارجي</td></tr>;
      })}</tbody></table></div>
  </section>;
}
