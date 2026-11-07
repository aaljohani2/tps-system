import {normalizeArabic,normalizeCourseCode} from './automatic-planning.js';
import type {WorkbookTable} from './automatic-xlsx.js';

type RoomType='CLASSROOM'|'LAB'|'MULTI';
export type RayatInstructor={code:string;name:string;maxLoad:number|null;courseEvidence:string[];sourceRows:number;scopeVerified:boolean};
export type RayatRoom={code:string;name:string;type:RoomType|null;capacity:number|null;building:string|null;sourceRows:number;scopeVerified:boolean};
export type RayatDiscovery={instructors:RayatInstructor[];rooms:RayatRoom[];warnings:string[];sheets:string[];unscoped:boolean};

const clean=(value:string|undefined)=>String(value??'').replace(/\s+/g,' ').trim();
const key=(value:string|undefined)=>normalizeArabic(clean(value)).replace(/[\s\/\\\-_.:()]+/g,'');
const latin=(value:string|undefined)=>normalizeArabic(clean(value)).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
  .replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
const aliases={
  trainerCode:['رقم المدرب','رمز المدرب','كود المدرب','رقم الموظف','رقم عضو هيئة التدريب',
    'رقم المدرب / الموظف','الرقم الوظيفي','trainer id','instructor id','instructor code','trainer code'],
  trainerName:['اسم المدرب','اسم عضو هيئة التدريب','اسم الموظف','اسم المدربة','الاسم / الوظيفة',
    'الاسم','trainer name','instructor name','instructor','المدرب','مدرب'],
  trainerScheduleCode:['المدرب (آلي)','رمز المدرب','رقم المدرب'],
  course:['رمز المقرر','المقرر','course code','course','رمز المادة'],
  load:['النصاب الأساسي','النصاب الأصلي','النصاب','النصاب المعتمد','max load','maximum load'],
  roomCode:['رمز القاعة','رقم القاعة','رقم القاعة / المعمل','رمز القاعة / المعمل','رقم المعمل',
    'القاعة','القاعة / المعمل','القاعه','room number','room code','room','classroom','lab number'],
  roomName:['اسم القاعة','اسم القاعة / المعمل','اسم المعمل','وصف القاعة','room name','lab name'],
  capacity:['سعة القاعة','الطاقة الاستيعابية','السعة الاستيعابية','عدد المقاعد','سعة المعمل','السعة',
    'room capacity','capacity','seats'],
  roomType:['نوع القاعة','نوع القاعة / المعمل','نوع المعمل','نوع المرفق','room type','type'],
  building:['المبنى','اسم المبنى','رمز المبنى','building','building name'],
  department:['القسم','اسم القسم','القسم التدريبي','department','department name'],
  college:['الكلية','الوحدة التدريبية','الجهة التدريبية','college','college name','training unit']
} as const;
const idx=(headers:string[],values:readonly string[]):number=>{
  const target=new Set(values.map(key));return headers.findIndex(x=>target.has(key(x)));
};
const same=(a:string,b:string)=>key(a).replace(/^قسم/,'')===key(b).replace(/^قسم/,'');
const skipIdentity=(s:string)=>!s||/اكتب الاسم|ادخل الاسم|اسم المدرب هنا|مدرب تجريبي|مدرب حضوري \d|مدرب اونلاين \d|رئيس القسم.*اكتب|وكيل.*اكتب/i.test(normalizeArabic(s));
const validCode=(code:string)=>!!code&&code.length<=60&&code!=='0'&&code!=='-'&&!/^0+(?:\.0+)?$/.test(code)&&!/افتراضي|online|عن بعد|بدون قاع|غير محدد|لا يوجد/i.test(normalizeArabic(code));
const number=(s:string,max:number):number|null=>{
  const x=latin(s).replace(/[,٬]/g,'').trim();
  if(!x)return null;
  if(!/^\d+(?:\.\d+)?$/.test(x))throw new Error('القيمة العددية غير صالحة: '+s);
  const n=Number(x);if(n>max||n<0)throw new Error('تجاوز الحد المسموح: '+s);return n;
};
const classify=(text:string):RoomType|null=>{
  const v=normalizeArabic(text);
  if(!v)return null;
  if(/متعدد|multi|multipurpose/.test(v))return 'MULTI';
  if(/معمل|مختبر|\blab\b/.test(v))return 'LAB';
  if(/نظري|قاعه تدريبيه|classroom|lecture/.test(v))return 'CLASSROOM';
  return null;
};
const codeFromSection=(text:string)=>{
  const m=normalizeCourseCode(text).match(/^(.+?-\d{2,4})(?:-(?:TH|PR|LAB|LEC|SEC|T|P)-?\d+)?$/);
  return m?.[1]??'';
};
/** Detect Rayat-like timetable, instructors directory, and facilities sheets without a fixed template.
 * No learner identifiers, attendee lists or historical availability are returned.
 */
export function discoverRayatResources(tables:WorkbookTable[],target:{department:string;college:string}):RayatDiscovery{
  const trainers=new Map<string,RayatInstructor>(),rooms=new Map<string,RayatRoom>();
  const warnings:string[]=[],sheets:string[]=[];let unscoped=false;
  let skippedDepartment=0,skippedCollege=0,ignored=0;
  for(const sheet of tables){
    let matched=false;
    for(let rowIndex=0;rowIndex<Math.min(35,sheet.rows.length);rowIndex++){
      const headers=sheet.rows[rowIndex]!.map(clean);
      const tc=idx(headers,aliases.trainerCode),tn=idx(headers,aliases.trainerName);
      const rc=idx(headers,aliases.roomCode),rn=idx(headers,aliases.roomName);
      if((tc<0||tn<0)&&rc<0)continue;
      const dd=idx(headers,aliases.department),cc=idx(headers,aliases.college);
      const course=idx(headers,aliases.course),load=idx(headers,aliases.load);
      const typ=idx(headers,aliases.roomType),cap=idx(headers,aliases.capacity),building=idx(headers,aliases.building);
      let observed=0;matched=true;
      for(const row of sheet.rows.slice(rowIndex+1)){
        const dept=dd<0?'':clean(row[dd]),college=cc<0?'':clean(row[cc]);
        const collegeMatches=cc<0||(!college?false:same(college,target.college));
        const deptMatches=dd<0||(!dept?false:same(dept,target.department));
        if(!collegeMatches){skippedCollege++;continue;}
        if(!deptMatches){skippedDepartment++;/* Keep college-wide rooms, but not other department's trainers. */}
        const explicitScope=cc>=0&&!!college&&collegeMatches;
        const trainerScope=explicitScope&&dd>=0&&!!dept&&deptMatches;
        const roomScope=explicitScope;
        if(tc>=0&&tn>=0&&deptMatches){
          const tcode=clean(row[tc]),name=clean(row[tn]);
          if(validCode(tcode)&&!skipIdentity(name)){
            if(!trainerScope)unscoped=true;
            const prior=trainers.get(tcode);
            if(prior&&!same(prior.name,name))
              throw new Error('رمز المدرب مكرر مع أسماء مختلفة: '+tcode);
            const parsedLoad=load>=0?number(clean(row[load]),200):null;
            const evidence=course<0?'':codeFromSection(clean(row[course]));
            const previous=prior??{code:tcode,name,maxLoad:null,courseEvidence:[],sourceRows:0,scopeVerified:true};
            if(parsedLoad!==null){
              if(previous.maxLoad!==null&&previous.maxLoad!==parsedLoad)
                throw new Error('تعارض النصاب للمدرب '+tcode);
              previous.maxLoad=parsedLoad;
            }
            if(evidence&&!previous.courseEvidence.includes(evidence))previous.courseEvidence.push(evidence);
            previous.sourceRows++;previous.scopeVerified&&=trainerScope;trainers.set(tcode,previous);
            observed++;
          }else if(tcode||name)ignored++;
        }
        if(rc>=0){
          const code=clean(row[rc]);
          if(!validCode(code))continue;
          if(!roomScope)unscoped=true;
          const name=rn>=0?clean(row[rn])||code:code;
          const roomType=typ>=0?classify(clean(row[typ])):null;
          const capacity=cap>=0?number(clean(row[cap]),1000):null;
          if(capacity!==null&&(!Number.isInteger(capacity)||capacity===0))
            throw new Error('سعة قاعة غير صالحة: '+code);
          const prior=rooms.get(code);
          if(prior&&prior.capacity!==null&&capacity!==null&&prior.capacity!==capacity)
            throw new Error('رمز القاعة '+code+' له سعات مختلفة في ملف Excel');
          if(prior&&prior.type&&roomType&&prior.type!==roomType)
            throw new Error('رمز القاعة '+code+' له نوعان مختلفان');
          const current=prior??{code,name,type:null,capacity:null,building:null,sourceRows:0,scopeVerified:true};
          if(current.name===code&&name!==code)current.name=name;
          current.capacity=capacity??current.capacity;
          current.type=roomType??current.type;
          current.building=(building>=0?clean(row[building]):'')||current.building;
          current.sourceRows++;current.scopeVerified&&=roomScope;
          rooms.set(code,current);observed++;
        }
      }
      if(observed>0)sheets.push(sheet.name);
      break;
    }
    if(!matched&&/قاع|مدرب|room|trainer/i.test(sheet.name))
      warnings.push('لم تُعرف أعمدة الموارد في الورقة '+sheet.name);
  }
  if(!trainers.size&&!rooms.size)throw new Error('لا يحتوي الملف بيانات مدربين أو قاعات برموز يمكن التحقق منها');
  if(skippedDepartment)warnings.push('تم تجاهل '+skippedDepartment+' صفًا لقسم مختلف عند استخراج المدربين');
  if(skippedCollege)warnings.push('تم تجاهل '+skippedCollege+' صفًا لكلية مختلفة');
  if(ignored)warnings.push('تجاهل النظام '+ignored+' مدربًا بلا رمز واسم حقيقيين أو بنص نموذجي');
  if(unscoped)warnings.push('بعض الأوراق لا تثبت الكلية/القسم في كل صف؛ يلزم إقرار صريح بنطاق الملف قبل الاستيراد');
  if([...rooms.values()].some(r=>!r.capacity||!r.type))
    warnings.push('بعض القاعات تفتقد السعة أو النوع؛ يجب استكمالها من مصدر معتمد قبل إدراجها في الجدولة');
  warnings.push('مقررات الجدول السابق دليل إسناد تاريخي فقط وليست إثبات أهلية، ولم تُستنتج إتاحة مستقبلية أو نصاب مجهول');
  return {instructors:[...trainers.values()].map(t=>({...t,courseEvidence:t.courseEvidence.sort()})).sort((a,b)=>a.code.localeCompare(b.code)),
    rooms:[...rooms.values()].sort((a,b)=>a.code.localeCompare(b.code)),warnings,sheets:[...new Set(sheets)],unscoped};
}
