import type {Scenario} from './api';
import {clock} from './time';
type Row={id:string;courseCode:string|null;rawTitle:string;level:number;physicalColored:boolean;plannedMode:string;kind:string;day:string|null;startMinute:number|null;endMinute:number|null;sourceCells:string[]};
type Snapshot={cohortBlocks:Array<{ref:string;level:number;size:number}>;stableBlockPlan?:{sourceRows:Row[];bindings:Array<{sourceItemId:string;blockIds:string[]}>;remoteSectionCapacity:number;smallBlockClosure?:unknown}};
const names:Record<string,string>={SUN:'الأحد',MON:'الاثنين',TUE:'الثلاثاء',WED:'الأربعاء',THU:'الخميس'};
export default function StableBlocksPanel({scenario}:{scenario:Scenario}){
 const input=scenario.input_snapshot as unknown as Snapshot,plan=input?.stableBlockPlan;if(!plan)return null;
 const sessions=scenario.result_snapshot.sessions as Array<{day:string;mode:string;blockId:string|null;blockIds?:string[]}>;
 const fixed=plan.sourceRows.filter(r=>r.kind!=='SELF_PACED'&&r.startMinute!==null&&r.endMinute!==null&&r.endMinute>r.startMinute);
 return <section className="panel" aria-label="البلوكات الثابتة والمصدر العام"><h3>البلوكات الثابتة والمقررات العامة</h3>
  <p role="status">مسودة غير مكتملة؛ لا تقسيم إضافي للشعب لاستكمال الأنصبة. سقف الشعبة عن بُعد {plan.remoteSectionCapacity} متدرب. نواقص المصدر والتغطية تمنع الاعتماد.</p>
  <p>{plan.sourceRows.length} ظهورًا محفوظًا من المصدر؛ تكرار الظهور لا يثبت عدد الشعب الفعلية أو بدائل مواعيدها. الربط بالمجموعات افتراض تخطيطي.</p>
  {!!plan.smallBlockClosure&&<p role="status">أغلقت بلوكات القسم الصغيرة: الثاني 43، 43، 43، 43 والرابع 49، 48. شعب العامة ومواعيدها وسعاتها الأصلية ثابتة؛ توزيع 12 متدربًا في الثاني و17 في الرابع على عضويات العامة معلق. المواعيد المدرجة للمقاعد الموروثة حجز تحفظي ولا تثبت تغطية كامل البلوك الجديد.</p>}
  <div className="table-wrap"><table aria-label="أيام قدوم البلوكات"><thead><tr><th>البلوك</th><th>المستوى</th><th>المتدربون</th><th>أيام القدوم للكلية</th><th>أيام عن بُعد</th><th>التغطية</th></tr></thead><tbody>
   {input.cohortBlocks.map(block=>{
    const internal=sessions.filter(s=>(s.blockIds??(s.blockId?[s.blockId]:[])).includes(block.ref));
    const external=fixed.filter(r=>plan.bindings.some(b=>b.sourceItemId===r.id&&b.blockIds.includes(block.ref)));
    const days=(mode:string)=>Object.keys(names).filter(d=>internal.some(s=>s.day===d&&s.mode===mode)||external.some(r=>r.day===d&&r.plannedMode===mode));
    const onsite=days('ONSITE');return <tr key={block.ref}><td>{block.ref}</td><td>{block.level}</td><td>{block.size}</td><td>{onsite.length}: {onsite.map(d=>names[d]).join('، ')||'لا يوجد موثق'}</td><td>{days('REMOTE').map(d=>names[d]).join('، ')||'لا يوجد موثق'}</td><td>غير مكتملة؛ الأيام للمواعيد الموثقة فقط</td></tr>;
   })}</tbody></table></div>
  <details><summary>سجل المصدر العام الثابت</summary><div className="table-wrap"><table aria-label="سجل المصدر العام"><thead><tr><th>المرجع</th><th>المقرر</th><th>المستوى</th><th>النمط</th><th>اليوم</th><th>البداية</th><th>النهاية</th></tr></thead><tbody>
   {plan.sourceRows.map(r=><tr key={r.id}><td>{r.id}</td><td>{r.rawTitle}</td><td>{r.level}</td><td>{r.plannedMode==='ONSITE'?'حضوري':'عن بُعد'}{r.kind==='SELF_PACED'?' — ذاتي':''}</td><td>{r.day?names[r.day]:'غير مكتمل'}</td><td>{r.startMinute===null?'غير مكتملة':clock(r.startMinute/60)}</td><td>{r.endMinute===null?'غير مكتملة':clock(r.endMinute/60)}</td></tr>)}
  </tbody></table></div></details></section>;
}
