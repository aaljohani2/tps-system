import type {Plan} from './api';
export default function CourseCoveragePanel({input,result}:{input:unknown;result:Plan}){
 const source=input as {policy?:{priorityCourseCodes?:string[]};courses?:Array<{code:string;title:string;assignmentScope?:string}>};
 const courses=(source?.courses??[]).filter(course=>source?.policy?.priorityCourseCodes?.includes(course.code));
 if(!courses.length)return null;
 return <section className="panel" aria-label="تغطية مقررات القسم ذات الأولوية"><h3>تغطية مقررات القسم ذات الأولوية</h3>
  <table><thead><tr><th>المقرر</th><th>جهة الإسناد</th><th>الشعب المجدولة / المطلوبة</th><th>الحالة</th></tr></thead><tbody>
   {courses.map(course=>{const sections=result.sections.filter(section=>section.courseCode===course.code),covered=sections.filter(section=>section.state!=='UNASSIGNED').length;
    return <tr key={course.code}><td>{course.title} ({course.code})</td><td>{course.assignmentScope==='EXTERNAL'?'قسم آخر':'داخل القسم'}</td>
     <td>{covered} / {sections.length}</td><td>{course.assignmentScope==='EXTERNAL'?'تعارض في تصنيف الإسناد':sections.length&&covered===sections.length?'مغطى بالكامل':'تغطية غير مكتملة'}</td></tr>;})}
  </tbody></table></section>;
}
