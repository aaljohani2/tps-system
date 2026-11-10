import type {Scenario} from './api';
import {clock} from './time';

type Stage={rows:Array<{id:string;level:number;section:number;title:string;day:string;period:string;startMinute:number;endMinute:number;mode:string}>};
const days:Record<string,string>={SUN:'الأحد',MON:'الاثنين',TUE:'الثلاثاء',WED:'الأربعاء',THU:'الخميس'};
export default function FixedGeneralStagePanel({scenario}:{scenario:Scenario}){
 const stage=(scenario.input_snapshot as {fixedGeneralStage?:Stage}).fixedGeneralStage;
 if(!stage)return null;
 const groups=new Set(stage.rows.map(r=>`${r.level}/${r.section}`));
 return <section className="panel" aria-label="المرحلة الأولى: أوقات المواد العامة المثبتة">
  <h3>المرحلة الأولى: أوقات المواد العامة المثبتة</h3>
  <p role="status">تم تثبيت {stage.rows.length} موعدًا من ملف الإكسل، لـ{groups.size} شعبة عبر {new Set(stage.rows.map(r=>r.level)).size} مستويات.</p>
  <p>المرحلة الثانية لم تبدأ: لم يُبن جدول القسم ولم يُسند المدربون أو يُوزع المتدربون. المواعيد الذاتية محفوظة كقيد وقت للشعبة دون حجز قاعة أو مدرب.</p>
  <a href={'/api/v1/scenarios/'+scenario.id+'/external.csv'}>تنزيل أوقات العامة المثبتة CSV</a>
  <div className="table-wrap"><table aria-label="أوقات العامة المثبتة لكل مستوى وشعبة">
   <thead><tr><th>المستوى</th><th>الشعبة</th><th>المقرر</th><th>اليوم</th><th>الفترة</th><th>البداية</th><th>النهاية</th><th>النمط حسب الملف</th><th>المرجع</th></tr></thead>
   <tbody>{stage.rows.map(r=><tr key={r.id}><td>{r.level}</td><td>{r.section}</td><td>{r.title}</td><td>{days[r.day]}</td><td>{r.period}</td>
    <td>{clock(r.startMinute/60)}</td><td>{clock(r.endMinute/60)}</td><td>{r.mode==='SELF_PACED'?'ذاتي':r.mode==='ONSITE'?'حضوري':'غير مذكور'}</td><td>{r.id}</td></tr>)}</tbody>
  </table></div>
 </section>;
}
