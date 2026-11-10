type Snapshot={
  policy?:{ignoreRoomCapacity?:boolean;courseSectionCapacities?:Record<string,number>};
  rooms?:Array<{type:string|null}>;
  courses:Array<{code:string;title:string;level:number;demand:number;theoryHours:number;practicalHours:number;sectionCapacity?:number;assignmentScope?:string}>;
  projection?:{label:string;newIntake:number;levelStudents:Record<string,number>;cooperativeStudents:number;
    cooperativeAdministrativeBlocks:number;assumptions:string[];rules:{theory:number;mixed:number;practical:number;economics:number|null}};
};
export default function ScenarioProjectionSummary({input,result}:{input:unknown;result:{sections:Array<{courseCode:string;students:number;capacity?:number|null}>}}){
  const snapshot=input as Snapshot|undefined,p=snapshot?.projection;
  if(!snapshot)return null;
  if(!p){
    const exceptions=Object.entries(snapshot.policy?.courseSectionCapacities??{}).filter(([code])=>snapshot.courses.find(course=>course.code===code)?.assignmentScope!=='EXTERNAL');
    return exceptions.length?<section className="panel"><h3>استثناءات سعات المقررات</h3>{exceptions.map(([code,capacity])=>{
      const course=snapshot.courses.find(item=>item.code===code);
      return <p key={code}>{course?.title??code}: <strong>{capacity}</strong> متدربًا للشعبة — {result.sections.filter(section=>section.courseCode===code).length} شعب.</p>;
    })}</section>:null;
  }
  return <section className="panel" aria-label="افتراضات وتوزيع السيناريو"><h3>افتراضات وتوزيع السيناريو</h3>
    <p>{p.label} · المستجدون المؤكدون: <strong>{p.newIntake}</strong>.</p>
    {snapshot.policy?.ignoreRoomCapacity&&<p className="alert">سعة القاعات غير مقيّدة في هذا السيناريو بقرارك التخطيطي.
      القاعات المسجلة: {snapshot.rooms?.length??0}، ويُستخدم منها ما له نوع موثق مع منع التعارض.</p>}
    <p>سعة النظري البحت: <strong>{p.rules.theory}</strong> · المقرر النظري ذو الشق العملي: <strong>{p.rules.mixed}</strong> · العملي البحت: <strong>{p.rules.practical}</strong>
      {p.rules.economics!==null&&<> · مقدمة في الاقتصاد: <strong>{p.rules.economics}</strong></>}.</p>
    <p>الأعداد حسب المستوى: {Object.entries(p.levelStudents).map(([level,count])=>`${level}: ${count}`).join(' · ')}.</p>
    <p>التدريب التعاوني: {p.cooperativeStudents} متدربًا، {p.cooperativeAdministrativeBlocks} بلوك إداري؛ مجموعات الإشراف لم تُحدد بعد. المشروع الإنتاجي موقوف.</p>
    <p className="hint">عدد الشعب أدناه لكل مقرر. الشعبة المختلطة تجمع الجزء النظري والعملي للمتدربين أنفسهم.</p>
    <div className="table-wrap"><table><thead><tr><th>المقرر</th><th>المستوى</th><th>التصنيف</th><th>المتدربون</th><th>سعة الشعبة</th><th>عدد الشعب</th><th>التوزيع</th></tr></thead>
      <tbody>{snapshot.courses.filter(course=>course.assignmentScope!=='EXTERNAL').map(course=>{
        const sections=result.sections.filter(section=>section.courseCode===course.code);
        return <tr key={course.code}><td>{course.title}<small>{course.code}</small></td><td>{course.level}</td>
          <td>{course.theoryHours&&course.practicalHours?'نظري وعملي':course.theoryHours?'نظري بحت':'عملي بحت'}</td>
          <td>{course.demand}</td><td>{course.sectionCapacity??sections[0]?.capacity??'—'}</td><td>{sections.length}</td>
          <td>{sections.map(section=>section.students).join('، ')}</td></tr>;
      })}</tbody></table></div>
    {p.assumptions.map((assumption,index)=><p className="hint" key={index}>{assumption}</p>)}
  </section>;
}
