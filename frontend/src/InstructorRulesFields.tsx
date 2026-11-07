export type TeachingRules={maxContactHours?:number;maxSections?:number;preferredSections?:number;allowedCourseTypes?:string[];preferredCourseTypes?:string[]};
const names:Record<string,string>={THEORY:'نظري بحت',PRACTICAL:'عملي بحت',MIXED:'نظري وعملي'};
export default function InstructorRulesFields({value,change}:{value:TeachingRules;change:(rules:TeachingRules)=>void}){
 return <fieldset><legend>حدود الجدول وأولويات الإسناد</legend><div className="form-grid">
  {(['maxContactHours','maxSections','preferredSections'] as const).map(key=><label key={key}>
   {{maxContactHours:'الحد الأقصى لساعات الجدول الفعلية',maxSections:'الحد الأقصى لعدد الشعب',preferredSections:'عدد الشعب المستهدف (أولوية)'}[key]}
   <input type="number" min="0" step={key==='maxContactHours'?'0.5':'1'} placeholder="دون حد إضافي" value={value[key]??''}
    onChange={event=>{const next={...value};if(event.target.value==='')delete next[key];else next[key]=Number(event.target.value);change(next);}}/>
  </label>)}
 </div><p>الأنواع المسموح بها (دون تحديد = جميع الأنواع المؤهل لها)</p><div className="actions">
  {Object.entries(names).map(([type,label])=><label key={type}><input type="checkbox" checked={value.allowedCourseTypes?.includes(type)??true}
   onChange={event=>{const current=value.allowedCourseTypes??Object.keys(names);change({...value,allowedCourseTypes:event.target.checked?[...current,type]:current.filter(item=>item!==type)});}}/>{label}</label>)}
 </div><p>أنواع المقررات ذات الأولوية</p><div className="actions">
  {Object.entries(names).map(([type,label])=><label key={type}><input type="checkbox" checked={value.preferredCourseTypes?.includes(type)??false}
   onChange={event=>change({...value,preferredCourseTypes:event.target.checked?[...(value.preferredCourseTypes??[]),type]:(value.preferredCourseTypes??[]).filter(item=>item!==type)})}/>{label}</label>)}
 </div></fieldset>;
}
