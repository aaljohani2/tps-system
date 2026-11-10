import {Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api,type Context} from './api';
type Dashboard={
  counts:Record<string,number>;
  demand:{projected:number;assignedBlocks:number;mismatchedCourses:number;withoutBlockLinks:number;
    courses:Array<{code:string;title:string;projected:number;block_total:number;source:string|null;confidence:string|null}>};
  recentScenarios:Array<{id:string;name:string;state:string;solver_status:string;created_at:string}>;
};
export default function DashboardPage({ctx}:{ctx:Context}){
  const q=useQuery({queryKey:['dashboard',ctx.departmentId,ctx.termId],
    queryFn:()=>api<Dashboard>('/dashboard?departmentId='+ctx.departmentId+'&termId='+ctx.termId)});
  if(q.isPending)return <section className="panel">جارٍ تحميل مؤشرات القسم...</section>;
  if(q.isError||!q.data)return <section className="panel"><h2>تعذر تحميل اللوحة</h2>
    <p>لا يمكن احتساب المؤشرات دون اتصال قاعدة البيانات والصلاحيات الصحيحة.</p></section>;
  const {counts,demand,recentScenarios}=q.data;
  const metrics:[string,string|number][]=[
    ['المقررات',counts.courses??0],['البرامج',counts.programs??0],['الأفواج',counts.cohorts??0],
    ['البلوكات',counts.blocks??0],['المدربون',counts.trainers??0],['القاعات',counts.rooms??0],
    ['السيناريوهات',counts.scenarios??0],['المعتمدة',counts.approved??0],
    ['الطلب المتوقع',demand.projected],['المتدربون في البلوكات',demand.assignedBlocks],
    ['مقررات غير متطابقة',demand.mismatchedCourses],['مقررات دون ربط',demand.withoutBlockLinks]
  ];
  return <section className="panel"><h2>لوحة مؤشرات القسم للفصل المحدد</h2>
    <p className="hint">جميع الأرقام مستخرجة من قاعدة PostgreSQL المحلية، ولا تمثل بيانات رايات أو اعتمادًا مؤسسيًا.</p>
    <div className="metrics">{metrics.map(([label,value])=><article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <div className="actions"><Link to="/academic">إدارة الأفواج والبلوكات</Link>
      <Link to="/demand">تقدير الطلب</Link><Link to="/scheduling">مراجعة الجداول</Link></div>
    <h3>تغطية الطلب وروابط البلوكات</h3>
    <div className="table-wrap"><table><thead><tr><th>المقرر</th><th>المتوقع</th><th>المرتبط</th><th>المصدر</th><th>الحالة</th></tr></thead><tbody>
      {demand.courses.map(c=><tr key={c.code}><td>{c.code}<small>{c.title}</small></td><td>{c.projected}</td>
        <td>{c.block_total}</td><td>{c.source??'بيانات أولية من المقرر'}</td>
        <td>{c.projected===c.block_total?'متطابق':c.block_total===0?'لم تُربط البلوكات':'تحتاج مطابقة'}</td></tr>)}
    </tbody></table></div>
    <h3>آخر السيناريوهات</h3><div className="table-wrap"><table><thead><tr><th>السيناريو</th><th>الحالة</th><th>المحرك</th><th>تاريخ الإنشاء</th></tr></thead><tbody>
      {recentScenarios.map(s=><tr key={s.id}><td>{s.name}</td><td>{s.state}</td><td>{s.solver_status}</td>
        <td>{new Date(s.created_at).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}</td></tr>)}
    </tbody></table></div>
  </section>;
}
