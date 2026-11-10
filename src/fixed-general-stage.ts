import type {Day,PlanRequest,PlanResult} from './types.js';

/** Source section labels are not trainee memberships or solver sections. */
export interface FixedGeneralStage {
 version:1;phase:'GENERAL_TIMES_ONLY';
 source:{file:string;sha256:string;sheet:string;receivedAt:string};
 rows:Array<{id:string;level:number;section:number;title:string;originalTitle:string;day:Day;
  period:string;startMinute:number;endMinute:number;mode:'UNSPECIFIED'|'ONSITE'|'SELF_PACED';
  timingEvidence:string;courseEvidence:string;sourceLabel:string;sourceRow:number}>;
}

export function validateFixedGeneralStage(stage:FixedGeneralStage):void {
 if(stage.version!==1||stage.phase!=='GENERAL_TIMES_ONLY'||!stage.source?.file||!stage.source.sheet||
  !/^[a-f0-9]{64}$/.test(stage.source.sha256)||!/^\d{4}-\d{2}-\d{2}$/.test(stage.source.receivedAt)||
  !Array.isArray(stage.rows)||!stage.rows.length||stage.rows.length>2000)throw Error('Invalid fixed general source');
 const seen=new Set<string>();
 for(const r of stage.rows){
  if(!r.id||seen.has(r.id)||!Number.isInteger(r.level)||r.level<1||!Number.isInteger(r.section)||r.section<1||
   !r.title||!r.originalTitle||!['SUN','MON','TUE','WED','THU'].includes(r.day)||
   !['UNSPECIFIED','ONSITE','SELF_PACED'].includes(r.mode)||!Number.isInteger(r.sourceRow)||r.sourceRow<2||
   !Number.isInteger(r.startMinute)||!Number.isInteger(r.endMinute)||r.startMinute<0||r.endMinute>1440||
   r.endMinute<=r.startMinute)throw Error('Invalid fixed general row: '+r.id);
  seen.add(r.id);
 }
 for(let i=0;i<stage.rows.length;i++)for(let j=i+1;j<stage.rows.length;j++){
  const a=stage.rows[i]!,b=stage.rows[j]!;
  // Even source self-paced times remain reserved at this stage, without assigning rooms or staff.
  if(a.level===b.level&&a.section===b.section&&a.day===b.day&&a.startMinute<b.endMinute&&b.startMinute<a.endMinute)
   throw Error('Overlapping fixed general source rows: '+a.id+' / '+b.id);
 }
}

export function fixedGeneralStageResult(input:PlanRequest):PlanResult {
 if(!input.fixedGeneralStage)throw Error('Fixed general stage required');
 validateFixedGeneralStage(input.fixedGeneralStage);
 return {status:'DRAFT',scenarioName:input.scenarioName,termId:input.termId,sections:[],sessions:[],gaps:[],instructorLoads:[],
  metrics:{requiredContactHours:0,assignedContactHours:0,uncoveredContactHours:0,sectionCount:0,uncoveredSectionCount:0},
  notices:['المرحلة الأولى: أوقات المقررات العامة مثبتة من الملف. المرحلة الثانية لم تبدأ؛ لا شعب قسم أو إسناد مدربين أو عضويات متدربين.','لم يشغل Timefold؛ الأوقات محفوظة من المصدر وليست نتيجة تحسين.']};
}
