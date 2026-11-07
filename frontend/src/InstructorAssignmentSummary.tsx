type Rules={maxContactHours?:number;maxSections?:number;preferredSections?:number;allowedCourseTypes?:string[];preferredCourseTypes?:string[]};
type Input={instructors:Array<{id:string;name:string;maxLoad:number;teachingRules?:Rules;eligibleCourseCodes?:string[]}>;
 courses:Array<{code:string;title:string;theoryHours:number;practicalHours:number}>};
type Result={sections:Array<{instructorId:string|null;courseCode:string;state:string;contactHours:number}>};
const names:Record<string,string>={THEORY:'نظري بحت',PRACTICAL:'عملي بحت',MIXED:'نظري وعملي'};
export default function InstructorAssignmentSummary({input,result}:{input:unknown;result:Result}){
 const snapshot=input as Input;
 if(!snapshot?.instructors?.some(instructor=>instructor.teachingRules&&Object.keys(instructor.teachingRules).length))return null;
 return <section className="panel" aria-label="ضوابط إسناد المدربين"><h3>ضوابط إسناد المدربين وساعات الجدول</h3>
  <p className="hint">ساعات الجدول الفعلية منفصلة عن النصاب المحتسب. الأولويات توجه التوزيع، وتبقى الشعب غير المغطاة ظاهرة.</p>
  <div className="table-wrap"><table><thead><tr><th>المدرب</th><th>قيد المقررات</th><th>الأولوية</th><th>الشعب المسندة</th><th>منها عملي بحت</th><th>ساعات الجدول</th><th>حد الساعات الفعلية</th><th>حد الشعب</th></tr></thead>
  <tbody>{snapshot.instructors.map(instructor=>{
   const rules=instructor.teachingRules??{},owned=result.sections.filter(section=>section.instructorId===instructor.id&&section.state!=='UNASSIGNED');
   const practical=owned.filter(section=>{const course=snapshot.courses.find(course=>course.code===section.courseCode);return course&&course.theoryHours===0&&course.practicalHours>0;});
   const permitted=instructor.eligibleCourseCodes?.map(code=>snapshot.courses.find(course=>course.code===code)?.title??code).join('، ');
   return <tr key={instructor.id}><td>{instructor.id} — {instructor.name}</td>
    <td>{permitted||rules.allowedCourseTypes?.map(type=>names[type]).join('، ')||'المقررات المؤهل لها'}</td>
    <td>{rules.preferredCourseTypes?.map(type=>names[type]).join('، ')||'—'}{rules.preferredSections!==undefined&&` · المستهدف ${rules.preferredSections} شعبة`}</td>
    <td>{owned.length}</td><td>{practical.length}</td><td>{owned.filter(section=>section.state==='SCHEDULED').reduce((sum,section)=>sum+section.contactHours,0)}</td>
    <td>{rules.maxContactHours??'دون حد إضافي'}</td><td>{rules.maxSections??'دون حد إضافي'}</td></tr>;
  })}</tbody></table></div></section>;
}
