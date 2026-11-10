import {clock} from './time';
export type LecturePeriods={academicHourMinutes:number;partialPeriod:'TRIM_END'|'FULL_PERIOD';regular:Array<{startMinute:number;endMinute:number;trainingHours:number}>;
 courseOverrides:Record<string,{periods:Array<{startMinute:number;endMinute:number;trainingHours:number}>;allowCohortOverlap:boolean}>};
export default function LecturePeriodsPanel({input}:{input:unknown}){
 const snapshot=input as {policy?:{lecturePeriods?:LecturePeriods};courses?:Array<{code:string;title:string}>};
 const periods=snapshot?.policy?.lecturePeriods;if(!periods)return null;
 const rows=[{name:'بقية المقررات',periods:periods.regular,warning:false},...Object.entries(periods.courseOverrides).map(([code,value])=>({
  name:snapshot.courses?.find(course=>course.code===code)?.title??code,periods:value.periods,warning:value.allowCohortOverlap}))];
 return <section className="panel" aria-label="فترات المحاضرات المحفوظة"><h3>فترات المحاضرات واستثناء الاقتصاد</h3>
  <p>الساعة التدريبية {periods.academicHourMinutes} دقيقة؛ النصاب والساعات التدريبية منفصلة عن الوقت الفعلي.</p>
  <div className="table-wrap"><table><thead><tr><th>المقررات</th><th>الفترات المسموحة</th><th>تعارض المتدربين</th></tr></thead>
  <tbody>{rows.map(row=><tr key={row.name}><td>{row.name}</td><td>{row.periods.map(period=><span key={period.startMinute} dir="ltr" style={{display:'inline-block',marginInlineEnd:16}}>
    {clock(period.startMinute/60)}–{clock(period.endMinute/60)}</span>)}</td><td>{row.warning?'تحذير ظاهر يسمح ببناء الجدول':'يمنع التداخل'}</td></tr>)}</tbody></table></div>
  <p className="hint">{periods.partialPeriod==='TRIM_END'?'اللقاء ذو ساعة تدريبية واحدة مدته 50 دقيقة، ويبدأ عند بداية إحدى الفترات.':'كل لقاء يحجز الفترة كاملة، ولو بقيت ساعة تدريبية واحدة من المقرر.'} تعارض المدرب والقاعة يظل ممنوعًا.</p>
 </section>;
}
