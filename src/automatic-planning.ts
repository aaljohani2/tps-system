import {parseCsv} from './importer.js';

export type DemandConfidence='HIGH'|'MEDIUM'|'LOW';
export type DemandSourceKind='ACTUAL_LEVEL_COUNTS'|'COURSE_REGISTRATIONS'|'HISTORICAL_WORKBOOK'|'LEVEL_TRANSITION';
export type AutomaticMode='ONSITE_THEORY'|'REMOTE_THEORY'|'PRACTICAL'|'MIXED';

export interface CurriculumMetadata {
  institution?:string;college?:string;department?:string;specialty?:string;
  program?:string;stage?:string;planVersion?:string;term?:string;
}
export interface AutomaticCourse {
  code:string;normalizedCode:string;title:string;level:number;
  theoryHours:number;practicalHours:number;tutorialHours:number;credits:number|null;
  prerequisites:string[];equivalents:string[];responsibleDepartment:string|null;
  alternativeGroup:string|null;specialKind:'REGULAR'|'COOPERATIVE_TRAINING'|'PRODUCTION_PROJECT';
  sourceRow:number;
}
export interface AutomaticCurriculum {
  schemaVersion:'tps.automatic-curriculum.v1';metadata:CurriculumMetadata;
  levels:Array<{level:number;courses:AutomaticCourse[]}>;courses:AutomaticCourse[];
  sourceRows:number;warnings:string[];
}
export interface LevelDemandInput {
  kind:DemandSourceKind;counts:Record<number,number>;label:string;
  confidence:DemandConfidence;sourceTermId?:string;targetTermId?:string;
  recordedAt?:string;isConfirmedForTarget?:boolean;
}
export interface LevelDemand {
  level:number;students:number;kind:DemandSourceKind;sourceLabel:string;
  confidence:DemandConfidence;historical:boolean;recordedAt?:string;
}
export interface CapacitySettings {
  remoteTheory:number;onsiteTheory:number;practical:number;mixed:number;
}
export interface OperationalCourseSetting {
  code:string;mode:AutomaticMode;theoryHours?:number;practicalHours?:number;
  exceptionReason?:string;exceptionApproved?:boolean;
}
export interface AutomaticCourseCalculation {
  code:string;title:string;level:number;demand:number;demandSource:string;
  confidence:DemandConfidence;historical:boolean;mode:AutomaticMode|null;capacity:number|null;
  academicGroups:number;groupSizes:number[];components:{theory:number;practical:number};
  contactHours:number;complete:boolean;resourceOwner:string|null;alternativeGroup:string|null;
  discrepancy:null|{planTheory:number;planTutorial:number;planPractical:number;
    scenarioTheory:number;scenarioPractical:number;reason:string|null;approved:boolean};
  note:string|null;
}
export interface AutomaticCalculation {
  courses:AutomaticCourseCalculation[];missingInputs:string[];
  totals:{academicGroups:number;trainingComponents:number;contactHours:number};
}

const ARABIC_DIGITS='٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS='۰۱۲۳۴۵۶۷۸۹';
function digits(value:string){return value.replace(/[٠-٩]/g,c=>String(ARABIC_DIGITS.indexOf(c)))
  .replace(/[۰-۹]/g,c=>String(PERSIAN_DIGITS.indexOf(c)));}
export function normalizeArabic(value:string):string{
  return digits(value).normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\uFEFF]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي')
    .replace(/ة/g,'ه').replace(/[ـًٌٍَُِّْ]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
}
export function normalizeCourseCode(value:string):string{
  return normalizeArabic(value).replace(/^او\s*>+\s*/,'').replace(/[\s\u00a0_ـ]+/g,'-')
    .replace(/[^\p{L}\p{N}-]+/gu,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toUpperCase();
}
const LEVEL_WORDS:Record<string,number>={
  الاول:1,الثاني:2,الثالث:3,الرابع:4,الخامس:5,السادس:6,
  السابع:7,الثامن:8,التاسع:9,العاشر:10,الحاديعشر:11,الثانيعشر:12
};
export function parseLevel(value:string):number{
  const normalized=normalizeArabic(value).replace(/\s+/g,'');
  for(const [word,n] of Object.entries(LEVEL_WORDS).sort(([a],[b])=>b.length-a.length))if(normalized.includes(word))return n;
  const found=normalized.match(/(?:^|\D)(1[0-2]|[1-9])(?:\D|$)/);
  return found?Number(found[1]):0;
}
function clean(value:string|undefined){return (value??'').trim().replace(/\s+/g,' ');}
function numberCell(value:string|undefined,field:string,row:number,maximum=500):number{
  const text=digits(clean(value));
  if(!text)return 0;
  const n=Number(text);
  if(!Number.isFinite(n)||n<0||n>maximum)throw new Error(`Row ${row}: invalid ${field}: ${value}`);
  return n;
}
function splitCodes(value:string|undefined):string[]{
  const text=clean(value);if(!text||text==='-')return [];
  const matches=text.match(/[\p{L}]+\s*-?\s*\d+/gu);
  const parts=matches?.length?matches:text.split(/[\s،,;؛|]+/);
  return [...new Set(parts.map(normalizeCourseCode).filter(Boolean))];
}
const aliases={
  code:['المقرر','رمز المقرر','رمز','course code','code'],
  title:['اسم المقرر','المقرر اسم','course title','title'],
  level:['الفصل التدريبي','المستوى','level','training level'],
  theory:['مح','نظري','الساعات النظرية','theory hours','theoryhours'],
  practical:['عم','عملي','الساعات العملية','practical hours','practicalhours'],
  tutorial:['تم','تمارين','ساعات التمارين','tutorial hours','tutorialhours'],
  credits:['و.م','الوحدات المعتمدة','الوحدات','credits','credit hours'],
  prerequisites:['المتطلبات السابقة','المتطلب السابق','المتطلب','prerequisites'],
  equivalents:['المقررات المكافئة','المكافئات','المكافئ','equivalents'],
  owner:['الجهة المسؤولة','القسم المسؤول','responsible department','owner'],
  alternative:['مجموعة البدائل','المسار البديل','alternative group'],
  institution:['المؤسسة','institution'],college:['الكلية','الوحدة التدريبية','college'],department:['القسم','department'],
  specialty:['التخصص','specialty'],program:['البرنامج','اسم البرنامج','program'],
  stage:['المرحلة التدريبية','المرحلة','stage'],planVersion:['إصدار الخطة','نسخة الخطة','plan version'],
  term:['الفصل التدريبي','الفصل','term','training term']
} as const;
function headerIndex(headers:string[],names:readonly string[],last=false):number{
  const normalized=headers.map(normalizeArabic),wanted=names.map(normalizeArabic);
  let found=-1;
  for(let i=0;i<normalized.length;i++)if(wanted.includes(normalized[i]!)){found=i;if(!last)return i;}
  return found;
}
function metadataValue(rows:string[][],headers:string[],names:readonly string[]):string|undefined{
  const idx=headerIndex(headers,names);
  if(idx<0)return undefined;
  return rows.slice(1).map(r=>clean(r[idx])).find(Boolean);
}

/** Discover organization/program labels without returning row-level personal data. */
export function extractTableMetadata(rows:string[][]):CurriculumMetadata{
  const metadata:CurriculumMetadata={};
  for(let headerRow=0;headerRow<Math.min(rows.length,25);headerRow++){
    const headers=rows[headerRow]!.map(clean);
    let found=0;
    for(const key of ['institution','college','department','specialty','program','stage','planVersion','term'] as const)
      if(headerIndex(headers,aliases[key])>=0)found++;
    if(!found)continue;
    const table=rows.slice(headerRow);
    for(const key of ['institution','college','department','specialty','program','stage','planVersion','term'] as const){
      if(metadata[key])continue;
      const value=metadataValue(table,headers,aliases[key]);if(value)metadata[key]=value;
    }
    if(found>=3)break;
  }
  return metadata;
}

export interface DiscoveredInstructor {
  code:string;name:string;maxLoad:number|null;eligibleCourseCodes:string[];
  allowedModes:Array<'ONSITE'|'REMOTE'>;sourceRows:number;
}

/**
 * Read an instructor timetable/directory with flexible Arabic or English headings.
 * Timetable rows establish course evidence only; occupied times are never re-labelled as future availability.
 */
export function extractInstructorDirectory(table:string[][],targetDepartment=''):{
  metadata:CurriculumMetadata;instructors:DiscoveredInstructor[];warnings:string[]
}{
  if(!table.length)throw new Error('ملف المدربين فارغ');
  const codeNames=['رقم المدرب','رمز المدرب','كود المدرب','trainer id','instructor id','trainer code','instructor code'];
  const nameNames=['اسم المدرب','الاسم / الوظيفة','الاسم','trainer name','instructor name'];
  const departmentNames=['القسم','department'];
  const maxLoadNames=['النصاب الأصلي','النصاب','max load','maximum load'];
  const modeNames=['نمط المدرب','نوع التدريب','وصف المحاضرة','طريقة التدريب','mode'];
  const headerRow=table.findIndex(row=>{
    const headers=row.map(clean);
    return headerIndex(headers,codeNames)>=0&&headerIndex(headers,nameNames)>=0;
  });
  if(headerRow<0)throw new Error('لم يُكتشف عمودا رمز المدرب واسم المدرب');
  const headers=table[headerRow]!.map(clean);
  const codeIdx=headerIndex(headers,codeNames),nameIdx=headerIndex(headers,nameNames);
  const departmentIdx=headerIndex(headers,departmentNames),courseIdx=headerIndex(headers,aliases.code);
  const maxLoadIdx=headerIndex(headers,maxLoadNames),modeIdx=headerIndex(headers,modeNames);
  const target=normalizeArabic(targetDepartment),byCode=new Map<string,{name:string;maxLoad:number|null;
    courses:Set<string>;modes:Set<'ONSITE'|'REMOTE'>;rows:number}>();
  let ignoredDepartmentRows=0;
  for(const [offset,row] of table.slice(headerRow+1).entries()){
    if(departmentIdx>=0&&target&&normalizeArabic(row[departmentIdx]??'')!==target){ignoredDepartmentRows++;continue;}
    const code=clean(row[codeIdx]),name=clean(row[nameIdx]);if(!code&&!name)continue;
    if(!code||!name||code.length>60)throw new Error(`صف ${headerRow+offset+2}: رمز/اسم المدرب غير صالح`);
    const current=byCode.get(code)??{name,maxLoad:null,courses:new Set<string>(),modes:new Set<'ONSITE'|'REMOTE'>(),rows:0};
    if(normalizeArabic(current.name)!==normalizeArabic(name))throw new Error(`رمز المدرب ${code} مرتبط بأكثر من اسم`);
    if(maxLoadIdx>=0&&clean(row[maxLoadIdx])){
      const value=numberCell(row[maxLoadIdx],'trainer max load',headerRow+offset+2,200);
      if(value>0)current.maxLoad=value;
    }
    const course=courseIdx<0?'':normalizeCourseCode(row[courseIdx]??'');if(course)current.courses.add(course);
    const mode=normalizeArabic(modeIdx<0?'':row[modeIdx]??'');
    current.modes.add(mode.includes('عن بعد')||mode.includes('اونلاين')||mode.includes('remote')?'REMOTE':'ONSITE');
    current.rows++;byCode.set(code,current);
  }
  const instructors=[...byCode].map(([code,value])=>({code,name:value.name,maxLoad:value.maxLoad,
    eligibleCourseCodes:[...value.courses].sort(),allowedModes:[...value.modes],sourceRows:value.rows}));
  if(!instructors.length)throw new Error(target?'لا توجد صفوف مدربين مطابقة للقسم المحدد':'لا توجد صفوف مدربين صالحة');
  const warnings:string[]=[];
  if(ignoredDepartmentRows)warnings.push(`تجاهل النظام ${ignoredDepartmentRows} صفًا لأقسام أخرى`);
  if(courseIdx<0)warnings.push('ملف المدربين لا يحتوي رموز مقررات؛ لن يُعتمد كملف أهلية مقررات تلقائيًا');
  warnings.push('لم تُستنتج إتاحة مستقبلية من أوقات الجدول السابق');
  return {metadata:extractTableMetadata(table),instructors,warnings};
}

/** Parse a curriculum file without inferring demand or silently discarding zero-contact alternatives. */
export function importAutomaticCurriculumCsv(raw:string):AutomaticCurriculum{
  if(Buffer.byteLength(raw,'utf8')>5*1024*1024)throw new Error('Curriculum CSV exceeds 5 MiB');
  const allRows=parseCsv(raw);if(allRows.length<2)throw new Error('Curriculum CSV is empty');
  const headerRow=allRows.findIndex((row,index)=>index<35&&headerIndex(row,aliases.code)>=0&&
    headerIndex(row,aliases.title)>=0&&headerIndex(row,aliases.level)>=0);
  if(headerRow<0)throw new Error('Required curriculum columns missing: code, title, level');
  const rows=allRows.slice(headerRow);
  const headers=rows[0]!.map(clean);
  const indexes={code:headerIndex(headers,aliases.code),title:headerIndex(headers,aliases.title),
    level:headerIndex(headers,aliases.level,true),theory:headerIndex(headers,aliases.theory),
    practical:headerIndex(headers,aliases.practical),tutorial:headerIndex(headers,aliases.tutorial),
    credits:headerIndex(headers,['و.م','عدد الوحدات']),prerequisites:headerIndex(headers,aliases.prerequisites),
    equivalents:headerIndex(headers,aliases.equivalents),owner:headerIndex(headers,aliases.owner),
    alternative:headerIndex(headers,aliases.alternative)};
  for(const key of ['code','title','level'] as const)if(indexes[key]<0)
    throw new Error(`Required curriculum column missing: ${key}`);
  if(indexes.theory<0&&indexes.practical<0&&indexes.tutorial<0)
    throw new Error('Curriculum must contain theory, practical, or tutorial hours');
  const courses:AutomaticCourse[]=[],seen=new Set<string>(),warnings:string[]=[];
  for(const [offset,row] of rows.slice(1).entries()){
    if(row.every((value,index)=>normalizeArabic(value)===normalizeArabic(headers[index]??'')))continue;
    const sourceRow=headerRow+offset+2,code=clean(row[indexes.code]),title=clean(row[indexes.title]);
    if(!code&&!title)continue;if(!code||!title)throw new Error(`Row ${sourceRow}: missing code/title`);
    const normalizedCode=normalizeCourseCode(code);if(seen.has(normalizedCode))
      throw new Error(`Duplicate normalized course code at row ${sourceRow}: ${code}`);seen.add(normalizedCode);
    const level=parseLevel(row[indexes.level]??'');if(!level)
      throw new Error(`Row ${sourceRow}: unknown training level: ${row[indexes.level]??''}`);
    const theoryHours=numberCell(row[indexes.theory],'theory hours',sourceRow);
    const practicalHours=numberCell(row[indexes.practical],'practical hours',sourceRow);
    const tutorialHours=numberCell(row[indexes.tutorial],'tutorial hours',sourceRow);
    const normalizedTitle=normalizeArabic(title);
    const specialKind:AutomaticCourse['specialKind']=/تدريب.*تعاوني/.test(normalizedTitle)?'COOPERATIVE_TRAINING':
      /مشروع.*انتاجي/.test(normalizedTitle)?'PRODUCTION_PROJECT':'REGULAR';
    let alternativeGroup=indexes.alternative>=0?clean(row[indexes.alternative])||null:null;
    if(!alternativeGroup&&specialKind!=='REGULAR')alternativeGroup=`LEVEL-${level}-PATH`;
    courses.push({code,normalizedCode,title,level,theoryHours,practicalHours,tutorialHours,
      credits:indexes.credits<0?null:numberCell(row[indexes.credits],'credits',sourceRow),
      prerequisites:indexes.prerequisites<0?[]:splitCodes(row[indexes.prerequisites]),
      equivalents:indexes.equivalents<0?[]:splitCodes(row[indexes.equivalents]),
      responsibleDepartment:indexes.owner<0?null:clean(row[indexes.owner])||null,
      alternativeGroup,specialKind,sourceRow});
  }
  const groups=new Map<string,AutomaticCourse[]>();for(const c of courses)if(c.alternativeGroup)
    groups.set(c.alternativeGroup,[...(groups.get(c.alternativeGroup)??[]),c]);
  for(const [group,items] of groups)if(items.length<2)warnings.push(`Alternative group ${group} has only one course`);
  const metadata:CurriculumMetadata={};
  for(const key of ['institution','college','department','specialty','program','stage','planVersion','term'] as const){
    const value=metadataValue(rows,headers,aliases[key]);if(value)metadata[key]=value;
  }
  const levels=[...new Set(courses.map(c=>c.level))].sort((a,b)=>a-b).map(level=>({level,courses:courses.filter(c=>c.level===level)}));
  return {schemaVersion:'tps.automatic-curriculum.v1',metadata,levels,courses,
    sourceRows:rows.length-1,warnings};
}

/** Pick exactly one documented source per level. Historical values remain visibly historical. */
export function resolveLevelDemand(levels:number[],sources:LevelDemandInput[]):{levels:LevelDemand[];missing:number[]}{
  const priority:DemandSourceKind[]=['ACTUAL_LEVEL_COUNTS','COURSE_REGISTRATIONS','HISTORICAL_WORKBOOK','LEVEL_TRANSITION'];
  const result:LevelDemand[]=[],missing:number[]=[];
  for(const level of [...new Set(levels)].sort((a,b)=>a-b)){
    let chosen:LevelDemandInput|undefined;
    for(const kind of priority){chosen=sources.find(s=>s.kind===kind&&Number.isInteger(s.counts[level])&&s.counts[level]!>=0);if(chosen)break;}
    if(!chosen){missing.push(level);continue;}
    const historical=(chosen.kind==='HISTORICAL_WORKBOOK'||chosen.kind==='LEVEL_TRANSITION')&&
      chosen.isConfirmedForTarget!==true;
    result.push({level,students:chosen.counts[level]!,kind:chosen.kind,sourceLabel:chosen.label,
      confidence:historical&&chosen.confidence==='HIGH'?'MEDIUM':chosen.confidence,historical,recordedAt:chosen.recordedAt});
  }
  return {levels:result,missing};
}

function capFor(mode:AutomaticMode,settings:CapacitySettings){return mode==='REMOTE_THEORY'?settings.remoteTheory:
  mode==='ONSITE_THEORY'?settings.onsiteTheory:mode==='PRACTICAL'?settings.practical:settings.mixed;}
function defaultMode(c:AutomaticCourse):AutomaticMode{
  const theory=c.theoryHours+c.tutorialHours;
  return theory>0&&c.practicalHours>0?'MIXED':c.practicalHours>0?'PRACTICAL':'ONSITE_THEORY';
}
export function calculateAutomaticPlan(curriculum:AutomaticCurriculum,demand:LevelDemand[],capacities:CapacitySettings,
  settings:OperationalCourseSetting[]=[],alternativeSelections:Record<string,string>={}):AutomaticCalculation{
  for(const [name,value] of Object.entries(capacities))if(!Number.isInteger(value)||value<=0)
    throw new Error(`Invalid capacity ${name}`);
  const demands=new Map(demand.map(d=>[d.level,d])),ops=new Map(settings.map(s=>[normalizeCourseCode(s.code),s]));
  const missingInputs:string[]=[],courses:AutomaticCourseCalculation[]=[];
  const missingLevels=[...new Set(curriculum.courses.map(c=>c.level).filter(level=>!demands.has(level)))];
  if(missingLevels.length)missingInputs.push(`MISSING_LEVEL_COUNTS:${missingLevels.join(',')}`);
  const groups=[...new Set(curriculum.courses.map(c=>c.alternativeGroup).filter((v):v is string=>!!v))];
  for(const group of groups)if(!alternativeSelections[group])missingInputs.push(`MISSING_ALTERNATIVE_SELECTION:${group}`);
  for(const c of curriculum.courses){
    const source=demands.get(c.level),operation=ops.get(c.normalizedCode);
    const selected=!c.alternativeGroup||normalizeCourseCode(alternativeSelections[c.alternativeGroup]??'')===c.normalizedCode;
    const planTheory=c.theoryHours,planScheduledTheory=c.theoryHours+c.tutorialHours;
    const scenarioTheory=operation?.theoryHours??planScheduledTheory;
    const scenarioPractical=operation?.practicalHours??c.practicalHours;
    // The historical workbook stores theory and tutorials in one operational column.
    // Compare that aggregate with the curriculum aggregate while retaining the plan split for audit.
    const discrepancy=scenarioTheory!==planScheduledTheory||scenarioPractical!==c.practicalHours?{
      planTheory,planTutorial:c.tutorialHours,planPractical:c.practicalHours,scenarioTheory,scenarioPractical,
      reason:operation?.exceptionReason??null,approved:operation?.exceptionApproved===true}:null;
    if(discrepancy&&!discrepancy.approved)missingInputs.push(`UNAPPROVED_HOUR_DIFFERENCE:${c.code}`);
    if(c.alternativeGroup&&!alternativeSelections[c.alternativeGroup]){
      courses.push({code:c.code,title:c.title,level:c.level,demand:source?.students??0,
        demandSource:source?.sourceLabel??'',confidence:source?.confidence??'LOW',historical:source?.historical??false,
        mode:null,capacity:null,academicGroups:0,groupSizes:[],components:{theory:0,practical:0},contactHours:0,
        complete:false,resourceOwner:c.responsibleDepartment,alternativeGroup:c.alternativeGroup,discrepancy,
        note:'Alternative path decision required'});continue;
    }
    if(!selected)continue;
    if(c.specialKind==='COOPERATIVE_TRAINING'&&scenarioTheory+scenarioPractical===0){
      courses.push({code:c.code,title:c.title,level:c.level,demand:source?.students??0,
        demandSource:source?.sourceLabel??'',confidence:source?.confidence??'LOW',historical:source?.historical??false,
        mode:null,capacity:null,academicGroups:0,groupSizes:[],components:{theory:0,practical:0},contactHours:0,
        complete:!!source,resourceOwner:c.responsibleDepartment,alternativeGroup:c.alternativeGroup,discrepancy,
        note:'Cooperative training requires a separate supervision policy; no regular lecture meetings were created'});continue;
    }
    const mode=operation?.mode??defaultMode(c),capacity=capFor(mode,capacities),students=source?.students??0;
    const academicGroups=source?Math.ceil(students/capacity):0;
    const groupSizes=Array.from({length:academicGroups},(_,i)=>Math.min(capacity,students-i*capacity));
    const components={theory:scenarioTheory>0?academicGroups:0,practical:scenarioPractical>0?academicGroups:0};
    courses.push({code:c.code,title:c.title,level:c.level,demand:students,demandSource:source?.sourceLabel??'',
      confidence:source?.confidence??'LOW',historical:source?.historical??false,mode,capacity,academicGroups,groupSizes,
      components,contactHours:academicGroups*(scenarioTheory+scenarioPractical),complete:!!source&&(!discrepancy||discrepancy.approved),
      resourceOwner:c.responsibleDepartment,alternativeGroup:c.alternativeGroup,discrepancy,note:null});
  }
  return {courses,missingInputs:[...new Set(missingInputs)],totals:{
    academicGroups:courses.reduce((n,c)=>n+c.academicGroups,0),
    trainingComponents:courses.reduce((n,c)=>n+c.components.theory+c.components.practical,0),
    contactHours:courses.reduce((n,c)=>n+c.contactHours,0)}};
}

/** Extract one internally consistent learner count per level from a historical course table. */
export function extractHistoricalLevelCounts(table:string[][]):{counts:Record<number,number>;warnings:string[]}{
  if(!table.length)throw new Error('Historical course table is empty');
  const countNames=['عدد المتدربين','الطلب المتوقع','الطلب','العدد','demand','students','student count'];
  const headerRow=table.findIndex(row=>headerIndex(row.map(clean),aliases.level,true)>=0&&
    headerIndex(row.map(clean),countNames)>=0);
  if(headerRow<0)throw new Error('Historical table must include level and learner-count columns');
  const headers=table[headerRow]!.map(clean),levelIdx=headerIndex(headers,aliases.level,true);
  const countIdx=headerIndex(headers,countNames);
  const values=new Map<number,Set<number>>();
  for(const [offset,row] of table.slice(headerRow+1).entries()){
    const level=parseLevel(row[levelIdx]??'');if(!level)continue;
    const count=numberCell(row[countIdx],'historical learner count',headerRow+offset+2,7500);
    if(!values.has(level))values.set(level,new Set());values.get(level)!.add(count);
  }
  const counts:Record<number,number>={},warnings:string[]=[];
  for(const [level,set] of values){
    if(set.size===1)counts[level]=[...set][0]!;
    else warnings.push(`Level ${level} has inconsistent historical counts: ${[...set].join(', ')}`);
  }
  return {counts,warnings};
}

export function extractHistoricalCourseSettings(table:string[][]):{
  settings:OperationalCourseSetting[];courseCount:number;warnings:string[]
}{
  if(!table.length)throw new Error('Historical course table is empty');
  const headerRow=table.findIndex(row=>headerIndex(row.map(clean),aliases.code)>=0&&
    headerIndex(row.map(clean),aliases.level,true)>=0);
  if(headerRow<0)throw new Error('Historical table must include a course-code column');
  const headers=table[headerRow]!.map(clean),codeIdx=headerIndex(headers,aliases.code);
  const theoryIdx=headerIndex(headers,[...aliases.theory,'نظري + تمارين','ساعات النظري والتمارين']);
  const practicalIdx=headerIndex(headers,aliases.practical);
  const modeIdx=headerIndex(headers,['النمط','طريقة التقديم','طريقة التدريب','نمط التدريب','mode','delivery mode']);
  if(codeIdx<0)throw new Error('Historical table must include a course-code column');
  const byCode=new Map<string,OperationalCourseSetting>(),warnings:string[]=[];
  for(const [offset,row] of table.slice(headerRow+1).entries()){
    const code=clean(row[codeIdx]);if(!code)continue;
    const normalized=normalizeCourseCode(code);
    if(byCode.has(normalized)){warnings.push(`Duplicate historical course code at row ${headerRow+offset+2}: ${code}`);continue;}
    const theoryHours=theoryIdx<0?undefined:numberCell(row[theoryIdx],'scenario theory hours',headerRow+offset+2);
    const practicalHours=practicalIdx<0?undefined:numberCell(row[practicalIdx],'scenario practical hours',headerRow+offset+2);
    const modeText=modeIdx<0?'':normalizeArabic(row[modeIdx]??'');
    let mode:AutomaticMode;
    if(modeText.includes('عن بعد')||modeText.includes('اونلاين')||modeText.includes('remote'))mode='REMOTE_THEORY';
    else if(modeText.includes('مختلط')||modeText.includes('mixed')||((theoryHours??0)>0&&(practicalHours??0)>0))mode='MIXED';
    else if(modeText.includes('عملي')||modeText.includes('practical')||((theoryHours??0)===0&&(practicalHours??0)>0))mode='PRACTICAL';
    else mode='ONSITE_THEORY';
    byCode.set(normalized,{code,mode,...(theoryIdx>=0?{theoryHours}:{}),...(practicalIdx>=0?{practicalHours}:{})});
  }
  return {settings:[...byCode.values()],courseCount:byCode.size,warnings};
}

export function extractHistoricalCapacities(table:string[][]):CapacitySettings|null{
  let remoteTheory:number|undefined,onsiteTheory:number|undefined,practical:number|undefined;
  for(const [index,row] of table.entries()){
    const label=normalizeArabic(row[0]??''),value=row[1];
    if(value===undefined||value==='')continue;
    if(label.includes('سعه نظري اونلاين')||label.includes('سعه نظري عن بعد'))
      remoteTheory=numberCell(value,'remote theory capacity',index+1,7500);
    else if(label.includes('سعه نظري حضوري'))onsiteTheory=numberCell(value,'onsite theory capacity',index+1,7500);
    else if(label.includes('سعه عملي')||label.includes('زوج مختلط'))
      practical=numberCell(value,'practical capacity',index+1,7500);
  }
  return remoteTheory&&onsiteTheory&&practical?{remoteTheory,onsiteTheory,practical,mixed:practical}:null;
}

export interface TraineeDemandExtraction {
  counts:Record<number,number>;
  courseCounts:Record<string,number>;
  sourceKind:'COURSE_REGISTRATIONS'|'COURSE_REMAINING';
  strategy:'REGISTERED_ROWS'|'OUTSTANDING_ROWS'|'ALL_TRAINEE_ROWS';
  uniqueTrainees:number;
  matchedTrainees:number;
  matchedRows:number;
  ignoredRows:number;
  unmatchedCourseRows:number;
  traineesAcrossMultipleLevels:number;
  warnings:string[];
}

const traineeAliases={
  id:['رقم المتدرب','الرقم التدريبي','رقم تدريبي','رقم المتدربة','student id','trainee id','student number'],
  name:['اسم المتدرب','إسم المتدرب','اسم المتدربة','student name','trainee name'],
  course:['المقرر','رمز المقرر','course code','course'],
  studentLevel:['مستوى المتدرب','المستوى الحالي','المستوى التدريبي','student level','current level'],
  courseLevel:['وصف المستوى','رمز المستوى','مستوى المقرر','course level'],
  registered:['مسجل','حالة التسجيل','التسجيل','registered','registration status'],
  fulfilled:['مستوفى','حالة الاستيفاء','مكتمل','منجز','fulfilled','completed']
} as const;

function booleanFlag(value:string|undefined):boolean|null{
  const normalized=normalizeArabic(value??'').replace(/\s+/g,'');
  if(!normalized)return null;
  if(['نعم','مسجل','مسجله','فعال','حالي','1','true','yes','registered'].includes(normalized))return true;
  if(['لا','غيرمسجل','غيرمسجله','0','false','no','notregistered'].includes(normalized))return false;
  return null;
}
function pickDominantLevel(frequencies:Map<number,number>):number{
  let selected=0,best=-1;
  for(const [level,count] of frequencies)if(count>best||(count===best&&level>selected)){selected=level;best=count;}
  return selected;
}

/**
 * Discover trainee-grain files without returning or persisting personal identifiers.
 * Repeated timetable meetings and repeated course rows are deduplicated per trainee/course.
 */
export function extractTraineeDemand(table:string[][],courseLevels:Record<string,number>={}):TraineeDemandExtraction{
  if(!table.length)throw new Error('ملف بيانات المتدربين فارغ');
  const headerRow=table.findIndex(row=>{
    const headers=row.map(clean);
    return headerIndex(headers,traineeAliases.id)>=0||headerIndex(headers,traineeAliases.name)>=0;
  });
  if(headerRow<0)throw new Error('لم يُكتشف عمود رقم المتدرب أو اسم المتدرب');
  const headers=table[headerRow]!.map(clean);
  const idIdx=headerIndex(headers,traineeAliases.id),nameIdx=headerIndex(headers,traineeAliases.name);
  const courseIdx=headerIndex(headers,traineeAliases.course),studentLevelIdx=headerIndex(headers,traineeAliases.studentLevel);
  const courseLevelIdx=headerIndex(headers,traineeAliases.courseLevel),registeredIdx=headerIndex(headers,traineeAliases.registered);
  const fulfilledIdx=headerIndex(headers,traineeAliases.fulfilled);
  if(studentLevelIdx<0&&courseLevelIdx<0&&courseIdx<0)
    throw new Error('يجب أن يحتوي ملف المتدربين على مستوى المتدرب أو رمز المقرر');
  const normalizedCourseLevels=new Map(Object.entries(courseLevels).map(([code,level])=>[normalizeCourseCode(code),level]));
  const sourceRows=table.slice(headerRow+1).filter(row=>row.some(value=>clean(value)));
  const hasRegisteredRows=registeredIdx>=0&&sourceRows.some(row=>booleanFlag(row[registeredIdx])===true);
  const hasOutstandingRows=!hasRegisteredRows&&fulfilledIdx>=0;
  const strategy:TraineeDemandExtraction['strategy']=hasRegisteredRows?'REGISTERED_ROWS':
    hasOutstandingRows?'OUTSTANDING_ROWS':'ALL_TRAINEE_ROWS';
  const sourceKind:TraineeDemandExtraction['sourceKind']=hasOutstandingRows?'COURSE_REMAINING':'COURSE_REGISTRATIONS';
  const students=new Map<string,Map<number,Set<string>>>(),directLevels=new Map<string,Map<number,number>>();
  const courses=new Map<string,Set<string>>(),allStudents=new Set<string>();
  let matchedRows=0,ignoredRows=0,unmatchedCourseRows=0,usedName=false;
  for(const row of sourceRows){
    const identifier=clean(row[idIdx>=0?idIdx:nameIdx]);
    if(!identifier){ignoredRows++;continue;}
    allStudents.add(identifier);if(idIdx<0)usedName=true;
    const registered=registeredIdx<0?null:booleanFlag(row[registeredIdx]);
    const fulfilled=fulfilledIdx<0?null:booleanFlag(row[fulfilledIdx]);
    if((strategy==='REGISTERED_ROWS'&&registered!==true)||(strategy==='OUTSTANDING_ROWS'&&fulfilled!==false)){
      ignoredRows++;continue;
    }
    const directLevel=studentLevelIdx<0?0:parseLevel(row[studentLevelIdx]??'');
    if(directLevel){
      const frequencies=directLevels.get(identifier)??new Map<number,number>();
      frequencies.set(directLevel,(frequencies.get(directLevel)??0)+1);directLevels.set(identifier,frequencies);
    }
    const code=courseIdx<0?'':normalizeCourseCode(row[courseIdx]??'');
    const rowLevel=courseLevelIdx<0?0:parseLevel(row[courseLevelIdx]??'');
    const mappedLevel=code?(normalizedCourseLevels.get(code)??0):0;
    const courseLevel=mappedLevel||rowLevel;
    if(code){
      if(courseLevel){
        const courseStudents=courses.get(code)??new Set<string>();courseStudents.add(identifier);courses.set(code,courseStudents);
      }else unmatchedCourseRows++;
    }
    if(courseLevel){
      const byLevel=students.get(identifier)??new Map<number,Set<string>>();
      const uniqueCourses=byLevel.get(courseLevel)??new Set<string>();
      uniqueCourses.add(code||`LEVEL-${courseLevel}`);byLevel.set(courseLevel,uniqueCourses);students.set(identifier,byLevel);
    }
    if(directLevel||courseLevel)matchedRows++;
  }
  const counts:Record<number,number>={},matchedIds=new Set([...students.keys(),...directLevels.keys()]);
  let traineesAcrossMultipleLevels=0;
  for(const identifier of matchedIds){
    const direct=directLevels.get(identifier);
    let frequencies:Map<number,number>;
    if(direct?.size)frequencies=direct;
    else{
      const byLevel=students.get(identifier)??new Map<number,Set<string>>();
      frequencies=new Map([...byLevel].map(([level,codes])=>[level,codes.size]));
    }
    if(frequencies.size>1)traineesAcrossMultipleLevels++;
    const level=pickDominantLevel(frequencies);if(level)counts[level]=(counts[level]??0)+1;
  }
  if(!Object.keys(counts).length){
    if(courseIdx>=0&&!normalizedCourseLevels.size&&courseLevelIdx<0)
      throw new Error('اكتُشف ملف تسجيلات مقررات. ارفع الخطة أولًا لربط رموز المقررات بالمستويات.');
    throw new Error('تعذر ربط صفوف المتدربين بأي مستوى تدريبي');
  }
  const warnings:string[]=[];
  if(usedName)warnings.push('استُخدم اسم المتدرب لإزالة التكرار داخل الذاكرة فقط لعدم وجود عمود رقم المتدرب');
  if(unmatchedCourseRows)warnings.push(`تعذر ربط ${unmatchedCourseRows} من صفوف المقررات بمستوى في الخطة`);
  if(traineesAcrossMultipleLevels)warnings.push(`لدى ${traineesAcrossMultipleLevels} متدربًا مقررات من عدة مستويات؛ استُخدم المستوى الغالب، وعند التعادل المستوى الأعلى`);
  const courseCounts=Object.fromEntries([...courses].sort(([a],[b])=>a.localeCompare(b))
    .map(([code,ids])=>[code,ids.size] as const));
  return {counts,courseCounts,sourceKind,strategy,uniqueTrainees:allStudents.size,matchedTrainees:matchedIds.size,
    matchedRows,ignoredRows,unmatchedCourseRows,traineesAcrossMultipleLevels,warnings};
}
