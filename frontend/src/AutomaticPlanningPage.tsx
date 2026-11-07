import {useEffect,useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,type Context} from './api';

type Course={code:string;normalizedCode:string;title:string;level:number;theoryHours:number;practicalHours:number;
  tutorialHours:number;responsibleDepartment:string|null;alternativeGroup:string|null;specialKind:string};
type Curriculum={metadata:Record<string,string>;levels:Array<{level:number;courses:Course[]}>;courses:Course[];warnings:string[];sourceRows:number};
type PlanPreview={sheet:string;curriculum:Curriculum};
type CapacitySettings={remoteTheory:number;onsiteTheory:number;practical:number;mixed:number};
type HistoryPreview={sheet:string;counts:Record<string,number>;metadata?:Record<string,string>;warnings:string[];settings:Array<Record<string,unknown>>;courseCount:number;capacities:CapacitySettings|null;
  courseCounts?:Record<string,number>;detection?:{kind:string;strategy:string;uniqueTrainees?:number;matchedTrainees?:number;
    matchedRows?:number;ignoredRows?:number;unmatchedCourseRows?:number;traineesAcrossMultipleLevels?:number}};
type Calculation={courses:Array<{code:string;title:string;level:number;demand:number;demandSource:string;confidence:string;
  historical:boolean;mode:string|null;capacity:number|null;academicGroups:number;groupSizes:number[];
  components:{theory:number;practical:number};contactHours:number;complete:boolean;resourceOwner:string|null;
  discrepancy:null|{planTheory:number;planTutorial:number;planPractical:number;scenarioTheory:number;scenarioPractical:number;approved:boolean};note:string|null}>;
  missingInputs:string[];totals:{academicGroups:number;trainingComponents:number;contactHours:number}};
type Materialization={programId:string;demandRecords:number;cohorts:number;blocks:number;assignments:number;
  blockCapacityByLevel:Record<string,number>;scenarioId:string|null;scenario:{state:string;solverStatus:string;metrics:{sectionCount:number;uncoveredSectionCount:number};gaps:number}|null;
  scenarioError:string|null;notice:string;solverStarted?:boolean;solverError?:string|null};
type ResourcePreview={sheet:string;metadata:Record<string,string>;instructors:number;courseLinkedInstructors:number;
  sourceRows:number;warnings:string[];ready:boolean;sha256:string};
type DetectedFile={name:string;roles:string[];detail:string};
type HistoryCandidate={file:File;preview:HistoryPreview;score:number};
const modeLabels:Record<string,string>={ONSITE_THEORY:'نظري حضوري',REMOTE_THEORY:'نظري عن بُعد',PRACTICAL:'عملي',MIXED:'نظري/عملي'};
const strategyLabels:Record<string,string>={AGGREGATED_COUNTS:'أعداد مجمعة حسب المستوى',REGISTERED_ROWS:'صفوف التسجيل الفعلي',
  OUTSTANDING_ROWS:'المقررات المتبقية غير المستوفاة',ALL_TRAINEE_ROWS:'جدول/تسجيلات المتدربين'};
const mime=(file:File)=>file.name.toLowerCase().endsWith('.csv')?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const normalized=(value:string)=>value.normalize('NFKC').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
  .replace(/[ـًٌٍَُِّْ]/g,'').replace(/\s+/g,' ').trim().toLowerCase();

export default function AutomaticPlanningPage({ctx,notify}:{ctx:Context;notify:(message:string)=>void}){
  const qc=useQueryClient();
  const programs=useQuery({queryKey:['programs',ctx.departmentId],queryFn:()=>api<Array<{id:string;code:string;name:string}>>('/programs?departmentId='+ctx.departmentId)});
  const [planFile,setPlanFile]=useState<File|null>(null),[dataFile,setDataFile]=useState<File|null>(null);
  const [plan,setPlan]=useState<PlanPreview|null>(null),[history,setHistory]=useState<HistoryPreview|null>(null);
  const [result,setResult]=useState<Calculation|null>(null),[working,setWorking]=useState(false);
  const [sourceKind,setSourceKind]=useState<'ACTUAL_LEVEL_COUNTS'|'COURSE_REGISTRATIONS'|'HISTORICAL_WORKBOOK'>('HISTORICAL_WORKBOOK');
  const [selections,setSelections]=useState<Record<string,string>>({});
  const [programId,setProgramId]=useState(''),[planCode,setPlanCode]=useState(''),[versionLabel,setVersionLabel]=useState('');
  const [savedPlanId,setSavedPlanId]=useState<string|null>(null),[integration,setIntegration]=useState<Materialization|null>(null);
  const [scenarioName,setScenarioName]=useState('سيناريو التخطيط الآلي');
  const [newProgramName,setNewProgramName]=useState(''),[newProgramCode,setNewProgramCode]=useState('');
  const [detectedFiles,setDetectedFiles]=useState<DetectedFile[]>([]);
  const [conflictingHistorySources,setConflictingHistorySources]=useState<HistoryCandidate[]>([]);
  const [resourceFile,setResourceFile]=useState<File|null>(null),[resourcePreview,setResourcePreview]=useState<ResourcePreview|null>(null);
  const [defaultMaxLoad,setDefaultMaxLoad]=useState(18);
  const [capacities,setCapacities]=useState<CapacitySettings>({remoteTheory:100,onsiteTheory:50,practical:40,mixed:40});
  const alternatives=useMemo(()=>{
    const groups=new Map<string,Course[]>();
    for(const course of plan?.curriculum.courses??[])if(course.alternativeGroup)
      groups.set(course.alternativeGroup,[...(groups.get(course.alternativeGroup)??[]),course]);
    return [...groups.entries()];
  },[plan]);
  useEffect(()=>{
    if(!plan)return;
    const candidate=plan.curriculum.metadata.program||plan.curriculum.metadata.specialty||'';
    if(candidate&&!newProgramName)setNewProgramName(candidate);
    const options=programs.data??[];
    const match=candidate?options.find(p=>normalized(p.name)===normalized(candidate)):undefined;
    if(match)setProgramId(match.id);else if(options.length===1&&!programId)setProgramId(options[0]!.id);
  },[plan,programs.data,newProgramName,programId]);
  const planPreview=(file:File)=>api<PlanPreview>('/automatic-planning/plan/preview?departmentId='+encodeURIComponent(ctx.departmentId),
    {method:'POST',headers:{'content-type':mime(file)},body:file});
  const historyPreview=(file:File,curriculum:PlanPreview|null)=>{
    const params=new URLSearchParams({departmentId:ctx.departmentId});
    if(curriculum)params.set('courseLevels',JSON.stringify(Object.fromEntries(
      curriculum.curriculum.courses.map(course=>[course.normalizedCode,course.level]))));
    return api<HistoryPreview>('/automatic-planning/history/preview?'+params,
      {method:'POST',headers:{'content-type':mime(file)},body:file});
  };
  const resourcesPreview=(file:File)=>api<ResourcePreview>('/automatic-planning/resources/preview?departmentId='+encodeURIComponent(ctx.departmentId),
    {method:'POST',headers:{'content-type':mime(file)},body:file});
  function applyPlan(file:File,preview:PlanPreview){
    const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14);
    setPlanFile(file);setPlan(preview);setResult(null);setSelections({});setSavedPlanId(null);setIntegration(null);
    setPlanCode(`AUTO-${stamp}`);setVersionLabel(`استيراد ذكي ${new Date().toLocaleDateString('ar-SA')}`);
    setScenarioName(`سيناريو تلقائي ${new Date().toLocaleDateString('ar-SA')}`);
    const programName=preview.curriculum.metadata.program||preview.curriculum.metadata.specialty||'';
    if(programName)setNewProgramName(programName);
    if(!newProgramCode)setNewProgramCode(`AUTO-${stamp.slice(-6)}`);
  }
  function sourceFor(preview:HistoryPreview,kind=sourceKind){
    const historical=kind==='HISTORICAL_WORKBOOK';
    return {kind,counts:preview.counts,label:historical?`مصنف سابق — ${preview.sheet}`:
      kind==='COURSE_REGISTRATIONS'?`سجلات متدربين مستخرجة — ${preview.sheet}`:`كشف فعلي — ${preview.sheet}`,
      confidence:historical?'MEDIUM':'HIGH',targetTermId:ctx.termId,isConfirmedForTarget:!historical};
  }
  function detectedSource(preview:HistoryPreview){
    if(preview.detection?.kind==='COURSE_REGISTRATIONS')return 'COURSE_REGISTRATIONS' as const;
    if(preview.detection?.kind==='COURSE_REMAINING')return 'ACTUAL_LEVEL_COUNTS' as const;
    return 'HISTORICAL_WORKBOOK' as const;
  }
  function inferAlternatives(curriculum:PlanPreview,demand:HistoryPreview){
    const result:Record<string,string>={};
    const counts=new Set(Object.keys(demand.courseCounts??{}).filter(code=>(demand.courseCounts?.[code]??0)>0).map(normalized));
    const groups=new Map<string,Course[]>();
    for(const course of curriculum.curriculum.courses)if(course.alternativeGroup)
      groups.set(course.alternativeGroup,[...(groups.get(course.alternativeGroup)??[]),course]);
    for(const [group,courses] of groups){
      const matched=courses.filter(course=>counts.has(normalized(course.normalizedCode))||counts.has(normalized(course.code)));
      if(matched.length===1)result[group]=matched[0]!.code;
    }
    return result;
  }
  async function analyzeFiles(files:File[]){
    if(!files.length)return;
    // A failed new upload must never leave an older plan and trainee count pair
    // available for approval under the new selected filenames.
    setWorking(true);setDetectedFiles([]);setConflictingHistorySources([]);
    setPlanFile(null);setPlan(null);setHistory(null);setDataFile(null);
    setResourceFile(null);setResourcePreview(null);setResult(null);
    setSavedPlanId(null);setIntegration(null);
    try{
      const detected=new Map(files.map(file=>[file.name,{name:file.name,roles:[] as string[],detail:''}]));
      let selectedPlan:{file:File;preview:PlanPreview}|null=null;
      for(const file of files)try{
        const preview=await planPreview(file);detected.get(file.name)!.roles.push('خطة ومقررات');
        detected.get(file.name)!.detail=`${preview.curriculum.courses.length} مقرر · ${preview.curriculum.levels.length} مستويات`;
        if(!selectedPlan||preview.curriculum.courses.length>selectedPlan.preview.curriculum.courses.length)
          selectedPlan={file,preview};
      }catch{/* A smart batch may contain non-curriculum files. */}
      if(!selectedPlan)throw new Error('لم يُكتشف ملف خطة يحتوي رمز المقرر واسمه ومستواه وساعاته');
      let selectedHistory:HistoryCandidate|null=null;
      const historyCandidates:HistoryCandidate[]=[];
      let selectedResources:{file:File;preview:ResourcePreview}|null=null;
      for(const file of files){
        try{
          const preview=await historyPreview(file,selectedPlan.preview);
          const score=(preview.detection?.kind==='COURSE_REGISTRATIONS'?300:
            preview.detection?.kind==='COURSE_REMAINING'?200:100)+(preview.detection?.uniqueTrainees??0);
          detected.get(file.name)!.roles.push('أعداد متدربين');
          detected.get(file.name)!.detail=[detected.get(file.name)!.detail,
            `${Object.keys(preview.counts).length} مستويات${preview.detection?.uniqueTrainees?` · ${preview.detection.uniqueTrainees} متدربًا فريدًا`:''}`].filter(Boolean).join(' · ');
          const candidate={file,preview,score};
          historyCandidates.push(candidate);
          if(!selectedHistory||score>selectedHistory.score)selectedHistory=candidate;
        }catch{/* Keep looking for another known dataset in the file. */}
        try{
          const preview=await resourcesPreview(file);
          detected.get(file.name)!.roles.push('مدربون وأهلية مقررات');
          detected.get(file.name)!.detail=[detected.get(file.name)!.detail,`${preview.instructors} مدربين · ${preview.courseLinkedInstructors} مرتبطين بمقررات`].filter(Boolean).join(' · ');
          if(preview.ready&&(!selectedResources||preview.courseLinkedInstructors>selectedResources.preview.courseLinkedInstructors))
            selectedResources={file,preview};
        }catch{/* File is not an instructor directory. */}
      }
      if(!selectedHistory)throw new Error('اكتُشفت الخطة، لكن لم يُكتشف ملف أعداد أو تسجيلات متدربين يمكن ربطه بمستوياتها');
      applyPlan(selectedPlan.file,selectedPlan.preview);
      // Multiple independent source files may represent different terms or
      // different trainee populations. Never pick the largest/highest score
      // silently when their level counts are materially different.
      const signatures=new Set(historyCandidates.map(candidate=>
        JSON.stringify(Object.entries(candidate.preview.counts).sort(([a],[b])=>Number(a)-Number(b)))));
      if(signatures.size>1){
        setConflictingHistorySources(historyCandidates);
        notify('اكتُشفت مصادر أعداد مختلفة؛ اختر مصدر الفصل الصحيح صراحة قبل الاعتماد. لم تُحفظ بيانات.');
      }else{
        setDataFile(selectedHistory.file);setHistory(selectedHistory.preview);
        const kind=detectedSource(selectedHistory.preview);setSourceKind(kind);
        if(selectedHistory.preview.capacities)setCapacities(selectedHistory.preview.capacities);
        setSelections(inferAlternatives(selectedPlan.preview,selectedHistory.preview));
      }
      if(selectedResources){setResourceFile(selectedResources.file);setResourcePreview(selectedResources.preview);}
      else{setResourceFile(null);setResourcePreview(null);}
      setDetectedFiles([...detected.values()].map(item=>item.roles.length?item:{...item,roles:['غير مستخدم'],detail:'لم تُكتشف بنية مدعومة في هذا الملف'}));
      if(signatures.size===1)notify(`اكتمل الاكتشاف الذكي: الخطة ${selectedPlan.preview.curriculum.courses.length} مقررًا، والأعداد من ${selectedHistory.file.name}.`);
    }catch(e){notify('تعذر إكمال الاكتشاف الذكي: '+String(e instanceof Error?e.message:e));}
    finally{setWorking(false);}
  }
  function chooseCountSource(candidate:HistoryCandidate){
    setDataFile(candidate.file);setHistory(candidate.preview);setSourceKind(detectedSource(candidate.preview));
    if(candidate.preview.capacities)setCapacities(candidate.preview.capacities);
    if(plan)setSelections(inferAlternatives(plan,candidate.preview));
    setConflictingHistorySources([]);
    setResult(null);setIntegration(null);
    notify('اعتُمد مصدر الأعداد للمعاينة: '+candidate.file.name+'؛ لم تُكتب أي بيانات بعد.');
  }
  async function uploadPlan(){if(!planFile)return;setWorking(true);try{
    const preview=await planPreview(planFile);applyPlan(planFile,preview);
    notify(`اكتُشف ${preview.curriculum.levels.length} مستويات و${preview.curriculum.courses.length} سجلًا للمقررات.`);
  }catch(e){notify('تعذر قراءة الخطة: '+String(e instanceof Error?e.message:e));}finally{setWorking(false);}}
  async function uploadData(){if(!dataFile)return;setWorking(true);try{
    const preview=await historyPreview(dataFile,plan);
    setHistory(preview);if(preview.capacities)setCapacities(preview.capacities);
    setSourceKind(detectedSource(preview));if(plan)setSelections(v=>({...inferAlternatives(plan,preview),...v}));
    setResult(null);
    notify(`اكتُشفت أعداد ${Object.keys(preview.counts).length} مستويات من ورقة ${preview.sheet}.`);
  }catch(e){notify('تعذر استخراج الأعداد: '+String(e instanceof Error?e.message:e));}finally{setWorking(false);}}
  async function ensureProgram(){
    if(programId)return programId;
    if(!newProgramName.trim()||!newProgramCode.trim())throw new Error('لم يوجد برنامج مطابق؛ أدخل اسم ورمز البرنامج المكتشف قبل الاعتماد');
    const created=await api<{id:string}>('/programs',{method:'POST',body:JSON.stringify({departmentId:ctx.departmentId,
      code:newProgramCode.trim(),name:newProgramName.trim()})});
    setProgramId(created.id);await qc.invalidateQueries({queryKey:['programs',ctx.departmentId]});return created.id;
  }
  async function commitVersion(selectedProgram:string){
    if(!planFile||!planCode.trim()||!versionLabel.trim())throw new Error('ملف الخطة ورمز الإصدار واسمه مطلوبة');
    const params=new URLSearchParams({departmentId:ctx.departmentId,programId:selectedProgram,
      planCode:planCode.trim(),versionLabel:versionLabel.trim()});
    return api<{planId:string;records:number;previousPlanId:string|null}>('/automatic-planning/plan/commit?'+params,
      {method:'POST',headers:{'content-type':mime(planFile)},body:planFile});
  }
  async function requestCalculation(){
    if(!plan||!history)throw new Error('الخطة وملف أعداد المتدربين مطلوبان');
    return api<Calculation>('/automatic-planning/calculate?departmentId='+encodeURIComponent(ctx.departmentId),{
      method:'POST',body:JSON.stringify({curriculum:plan.curriculum,sources:[sourceFor(history)],
        capacities,settings:history.settings,alternativeSelections:selections})});
  }
  async function applySystem(planId:string,calculated:Calculation){
    if(!history)throw new Error('مصدر أعداد المتدربين غير موجود');
    const applied=await api<Materialization>('/automatic-planning/materialize?departmentId='+encodeURIComponent(ctx.departmentId),{
      method:'POST',body:JSON.stringify({planId,termId:ctx.termId,scenarioName:scenarioName.trim()||'سيناريو التخطيط الآلي',
        sources:[sourceFor(history)],
        capacities,settings:history.settings,alternativeSelections:selections})});
    let solverStarted=false,solverError:string|null=null;
    if(applied.scenarioId)try{
      await api('/scenarios/'+applied.scenarioId+'/solve/async',{method:'POST',body:JSON.stringify({seconds:5,candidatesPerInstructor:6})});
      solverStarted=true;
    }catch(error){solverError=error instanceof Error?error.message:String(error);}
    setIntegration({...applied,solverStarted,solverError});return applied;
  }
  async function saveVersion(){if(!planFile||!planCode.trim()||!versionLabel.trim())return;setWorking(true);try{
    const selectedProgram=await ensureProgram(),saved=await commitVersion(selectedProgram);
    setSavedPlanId(saved.planId);setIntegration(null);
    notify(`حُفظ إصدار خطة جديد كمسودة مستقلة (${saved.records} سجلًا) دون استبدال الإصدار السابق.`);await qc.invalidateQueries();
  }catch(e){notify('تعذر حفظ إصدار الخطة: '+String(e instanceof Error?e.message:e));}finally{setWorking(false);}}
  async function calculate(){if(!plan||!history)return;setWorking(true);try{
    const calculated=await requestCalculation();
    setResult(calculated);notify(calculated.missingInputs.length?'اكتمل الحساب مع قرارات أو بيانات ناقصة موضحة أدناه.':'اكتمل احتساب الطلب والشعب تلقائيًا.');
  }catch(e){notify('تعذر الحساب: '+String(e instanceof Error?e.message:e));}finally{setWorking(false);}}
  async function materialize(){if(!savedPlanId||!plan||!history||!result||result.missingInputs.length)return;setWorking(true);try{
    const applied=await applySystem(savedPlanId,result);await qc.invalidateQueries();
    notify(applied.scenarioId?'حُدّث الطلب والأفواج والبلوكات وأُنشئ سيناريو جديد.':'حُدّثت البيانات، وتعذر إنشاء السيناريو بسبب متطلبات موضحة أدناه.');
  }catch(e){notify('تعذر تحديث النظام: '+String(e instanceof Error?e.message:e));}finally{setWorking(false);}}
  async function runFullIntegration(){if(!plan||!history||!planFile)return;setWorking(true);try{
    const calculated=await requestCalculation();setResult(calculated);
    if(calculated.missingInputs.length){notify('توقف الاعتماد لأن هناك قرار مسار أو بيانات ناقصة موضحة في الصفحة.');return;}
    const selectedProgram=await ensureProgram();
    let planId=savedPlanId;
    if(!planId){const saved=await commitVersion(selectedProgram);planId=saved.planId;setSavedPlanId(planId);}
    if(resourceFile&&resourcePreview?.ready){
      const params=new URLSearchParams({departmentId:ctx.departmentId,expectedSha256:resourcePreview.sha256,
        defaultMaxLoad:String(defaultMaxLoad)});
      await api('/automatic-planning/resources/commit?'+params,{method:'POST',headers:{'content-type':mime(resourceFile)},body:resourceFile});
    }
    const applied=await applySystem(planId,calculated);await qc.invalidateQueries();
    notify(applied.scenarioId?'اكتمل الاستيراد الذكي وتحديث النظام وبدأ Timefold.':'اكتمل تحديث السجلات، لكن إنشاء السيناريو يحتاج معالجة التنبيه الظاهر.');
  }catch(e){notify('تعذر إكمال الاستيراد الذكي: '+String(e instanceof Error?e.message:e));}finally{setWorking(false);}}
  return <section className="panel automatic-planning"><h2>التخطيط الآلي من الملفات الأساسية</h2>
    <p className="hint">ارفع الملفات المتاحة معًا دون قالب محدد. يكتشف النظام الخطة والمقررات وبيانات المتدربين والمدربين، ثم يعرض ما سيُحدّث قبل الحفظ.</p>
    <section className="smart-intake"><h3>الاستيراد الذكي الموحد</h3>
      <label>ملفات الكلية أو القسم أو الخطة أو المتدربين أو المدربين
        <input type="file" accept=".csv,.xlsx" multiple disabled={working}
          onChange={e=>void analyzeFiles(Array.from(e.target.files??[]))}/></label>
      <p className="hint">يمكن اختيار عدة ملفات مرة واحدة. لا تُحفظ الملفات نفسها ولا أسماء المتدربين؛ تُحفظ فقط السجلات التشغيلية التي تظهر في المعاينة.</p>
      {!!detectedFiles.length&&<div className="table-wrap"><table><thead><tr><th>الملف</th><th>ما اكتُشف</th><th>الملخص</th></tr></thead><tbody>
        {detectedFiles.map(file=><tr key={file.name}><td>{file.name}</td><td>{file.roles.join('، ')}</td><td>{file.detail}</td></tr>)}
      </tbody></table></div>}
    </section>
    {!!conflictingHistorySources.length&&<section className="alert" role="alert">
      <h3>مصادر أعداد متعارضة — يلزم تحديد المرجع قبل اعتماد الاستيراد</h3>
      <p>لا يمكن دمج أعداد ملفات متعددة أو اختيار أكبر عدد تلقائيًا؛ قد تخص فصولًا أو فئات مختلفة.</p>
      {conflictingHistorySources.map(candidate=><div key={candidate.file.name}>
        <strong>{candidate.file.name}</strong>
        <span> — {Object.entries(candidate.preview.counts).sort(([a],[b])=>Number(a)-Number(b))
          .map(([level,count])=>`المستوى ${level}: ${count}`).join(' · ')}</span>
        <button type="button" disabled={working} onClick={()=>chooseCountSource(candidate)}>
          استخدام أعداد هذا الملف فقط
        </button>
      </div>)}
    </section>}
    <ol className="workflow"><li>رفع الخطة</li><li>اكتشاف المقررات</li><li>قراءة الأعداد</li><li>احتساب الشعب</li><li>تحليل الموارد</li><li>تشغيل Timefold</li></ol>
    <div className="split"><section><h3>١. الخطة التدريبية</h3><label>CSV أو Excel<input type="file" accept=".csv,.xlsx" disabled={working}
      onChange={e=>{setPlanFile(e.target.files?.[0]??null);setPlan(null);setResult(null);}}/></label>
      <button className="primary" disabled={!planFile||working} onClick={uploadPlan}>اكتشاف الخطة تلقائيًا</button></section>
    <section><h3>٢. مصدر أعداد المتدربين</h3><label>نوع المصدر<select value={sourceKind} onChange={e=>setSourceKind(e.target.value as typeof sourceKind)}>
      <option value="ACTUAL_LEVEL_COUNTS">كشف فعلي للفصل المحدد</option><option value="COURSE_REGISTRATIONS">جدول/تسجيلات متدربين (اكتشاف ذكي)</option>
      <option value="HISTORICAL_WORKBOOK">مصنف تخطيط سابق (تقدير تاريخي)</option></select></label>
      <label>CSV أو Excel<input type="file" accept=".csv,.xlsx" disabled={working} onChange={e=>{setDataFile(e.target.files?.[0]??null);setHistory(null);setResult(null);}}/></label>
      <button disabled={!dataFile||working} onClick={uploadData}>استخراج الأعداد والإعدادات</button></section></div>
    {plan&&<><div className="alert success">تم اكتشاف {plan.curriculum.levels.length} مستويات تدريبية و{plan.curriculum.courses.length} سجلًا للمقررات من {plan.sheet}.</div>
      {!!Object.keys(plan.curriculum.metadata).length&&<div className="metadata-grid">
        {Object.entries(plan.curriculum.metadata).map(([key,value])=><article key={key}><span>{({institution:'المؤسسة',college:'الكلية',department:'القسم',
          specialty:'التخصص',program:'البرنامج',stage:'المرحلة',planVersion:'إصدار الخطة',term:'الفصل'} as Record<string,string>)[key]??key}</span><strong>{value}</strong></article>)}
      </div>}
      <div className="level-cards">{plan.curriculum.levels.map(level=><article key={level.level}><strong>المستوى {level.level}</strong><span>{level.courses.length} مقررات</span></article>)}</div>
      {alternatives.map(([group,courses])=><label key={group}>قرار المسار — {group}<select value={selections[group]??''} onChange={e=>setSelections(v=>({...v,[group]:e.target.value}))}>
        <option value="">اختر المسار المعتمد</option>{courses.map(c=><option key={c.normalizedCode} value={c.code}>{c.title} — {c.code}</option>)}</select></label>)}
      <details open={!savedPlanId}><summary>حفظ الخطة كإصدار مسودة مستقل</summary><div className="form-grid"><label>البرنامج<select value={programId} onChange={e=>setProgramId(e.target.value)}>
        <option value="">اختر البرنامج المحفوظ</option>{(programs.data??[]).map(p=><option key={p.id} value={p.id}>{p.name} — {p.code}</option>)}</select></label>
        {!programId&&<><label>اسم برنامج جديد مكتشف<input value={newProgramName} onChange={e=>setNewProgramName(e.target.value)}/></label>
          <label>رمز البرنامج الجديد<input value={newProgramCode} onChange={e=>setNewProgramCode(e.target.value)}/></label></>}
        <label>رمز الإصدار<input value={planCode} onChange={e=>setPlanCode(e.target.value)} placeholder="PLAN-1447-V2"/></label>
        <label>اسم الإصدار<input value={versionLabel} onChange={e=>setVersionLabel(e.target.value)} placeholder="خطة 1447 — الإصدار 2"/></label>
        <button disabled={working||(!programId&&(!newProgramName.trim()||!newProgramCode.trim()))||!planCode.trim()||!versionLabel.trim()} onClick={saveVersion}>حفظ إصدار مسودة جديد</button></div>
        <p className="hint">لا يُنشّط الإصدار تلقائيًا، ولا يُعدّل إصدارًا سابقًا أو سيناريو معتمدًا.</p>
        </details>
      {savedPlanId&&<div className="alert success">تم حفظ إصدار الخطة، وهو جاهز لتحديث بقية النظام.</div>}</>}
    {history&&<><h3>الأعداد المستخرجة</h3><div className="table-wrap"><table><thead><tr><th>المستوى</th><th>العدد</th><th>الحالة</th></tr></thead><tbody>
      {Object.entries(history.counts).sort(([a],[b])=>Number(a)-Number(b)).map(([level,count])=><tr key={level}><td>{level}</td><td>{count}</td>
        <td>{sourceKind==='HISTORICAL_WORKBOOK'?'تاريخي — يحتاج تحقق صلاحيته للفصل':
          sourceKind==='COURSE_REGISTRATIONS'?'مستخرج بعد إزالة تكرار المتدرب/المقرر':'فعلي للفصل المحدد'}</td></tr>)}</tbody></table></div>
      {history.detection?.uniqueTrainees!==undefined&&<div className="alert success">اكتشف النظام {history.detection.uniqueTrainees} متدربًا فريدًا،
        وطابق المستوى لـ{history.detection.matchedTrainees??0} منهم. أزيل تكرار اللقاءات والمقررات آليًا.</div>}
      {!!history.warnings.length&&<div className="alert">{history.warnings.map(warning=><div key={warning}>{warning}</div>)}</div>}
      <p className="hint">ورقة المصدر: {history.sheet} · المقررات المكتشفة: {history.courseCount} · طريقة الاستخراج: {strategyLabels[history.detection?.strategy??'']??'أعداد مجمعة'}</p></>}
    {plan&&history&&<details><summary>سعات السياسة المستخدمة في الحساب</summary><div className="form-grid">
      {([['remoteTheory','نظري عن بُعد'],['onsiteTheory','نظري حضوري'],['practical','عملي'],['mixed','مختلط']] as const).map(([key,label])=><label key={key}>{label}
        <input type="number" min="1" value={capacities[key]} onChange={e=>setCapacities(v=>({...v,[key]:Number(e.target.value)}))}/></label>)}</div></details>}
    {resourcePreview&&<div className={resourcePreview.ready?'alert success':'alert'}>اكتُشف {resourcePreview.instructors} مدربًا،
      منهم {resourcePreview.courseLinkedInstructors} يمكن ربطهم بمقررات القسم.
      {resourcePreview.ready&&<label>النصاب الافتراضي للمدرب الجديد فقط<input type="number" min="1" max="200" value={defaultMaxLoad}
        onChange={e=>setDefaultMaxLoad(Number(e.target.value))}/></label>}
      {resourcePreview.warnings.map(warning=><div key={warning}>{warning}</div>)}</div>}
    {plan&&history&&<section className="integration-panel"><h3>اعتماد الاستيراد وتحديث التطبيق</h3>
      <p className="hint">ينفذ الحفظ والحساب وتحديث الطلب والأفواج والبلوكات، ويستورد المدربين المرتبطين إن وُجد ملف صالح، ثم ينشئ السيناريو ويبدأ Timefold. يتوقف قبل الكتابة عند نقص قرار أو تعارض مع طلب يدوي.</p>
      <label>اسم السيناريو<input value={scenarioName} maxLength={160} onChange={e=>setScenarioName(e.target.value)}/></label>
      <button className="primary" disabled={working||alternatives.some(([group])=>!selections[group])||
        (!programId&&(!newProgramName.trim()||!newProgramCode.trim()))||!planCode.trim()||!versionLabel.trim()}
        onClick={runFullIntegration}>اعتماد الملفات وتحديث كامل النظام وتشغيل Timefold</button>
    </section>}
    {plan&&history&&<button className="primary" disabled={working||alternatives.some(([group])=>!selections[group])} onClick={calculate}>احتساب الطلب والشعب تلقائيًا</button>}
    {!history&&plan&&<div className="alert">الخطة جاهزة. ارفع كشف أعداد المتدربين أو التسجيلات فقط لإكمال الحساب؛ لا تُدخل طلب كل مقرر يدويًا.</div>}
    {result&&<><div className="metrics"><article><span>الشعب الأكاديمية</span><strong>{result.totals.academicGroups}</strong></article>
      <article><span>المكونات التدريبية</span><strong>{result.totals.trainingComponents}</strong></article><article><span>الساعات المطلوبة</span><strong>{result.totals.contactHours}</strong></article>
      <article className={result.missingInputs.length?'danger':''}><span>بيانات/قرارات ناقصة</span><strong>{result.missingInputs.length}</strong></article></div>
      {!!result.missingInputs.length&&<div className="alert error">{result.missingInputs.map(x=><div key={x}>{x}</div>)}</div>}
      <div className="table-wrap"><table><thead><tr><th>المقرر</th><th>المستوى</th><th>مصدر العدد</th><th>الطلب</th><th>النمط</th><th>السعة</th><th>الشعب</th><th>نظري/عملي</th><th>الساعات</th><th>الجهة</th><th>الحالة</th></tr></thead><tbody>
      {result.courses.map(c=><tr key={c.code}><td><strong>{c.title}</strong><small>{c.code}</small></td><td>{c.level}</td><td>{c.demandSource}<small>{c.historical?'تقدير تاريخي':'بيانات فعلية'} · {c.confidence}</small></td>
        <td>{c.demand}</td><td>{c.mode?modeLabels[c.mode]:c.note??'—'}</td><td>{c.capacity??'—'}</td><td>{c.academicGroups}<small>{c.groupSizes.join('، ')}</small></td>
        <td>{c.components.theory}/{c.components.practical}</td><td>{c.contactHours}</td><td>{c.resourceOwner??'غير محددة'}</td>
        <td>{c.discrepancy?<span className="tag">اختلاف ساعات يحتاج اعتمادًا</span>:c.complete?'مكتمل':'ناقص'}</td></tr>)}</tbody></table></div>
      <p className="hint">هذه المعاينة تشرح الحساب. زر اعتماد الملفات أعلاه هو الذي يكتب السجلات ويبدأ Timefold؛ لا تُعامل المعاينة وحدها بوصفها نتيجة تحسين.</p></>}
    {result&&!result.missingInputs.length&&<section className="integration-panel"><h3>تحديث النظام بالكامل</h3>
      <p className="hint">ينشئ تقديرات الطلب والأفواج وبلوكات المستوى وتعيينات المقررات وسيناريو جديدًا، ثم يبدأ Timefold. يعاد بناء السجلات الآلية لهذا الإصدار والفصل فقط؛ السجلات اليدوية والسيناريوهات السابقة لا تُحذف.</p>
      <label>اسم السيناريو<input value={scenarioName} maxLength={160} onChange={e=>setScenarioName(e.target.value)}/></label>
      {!savedPlanId&&<div className="alert">احفظ الخطة كإصدار مسودة أولًا لربط التحليل بسجلات النظام.</div>}
      <button className="primary" disabled={!savedPlanId||working} onClick={materialize}>تحديث الطلب والأفواج والبلوكات وتشغيل Timefold</button>
      {integration&&<div className="alert success"><strong>اكتمل تحديث السجلات</strong><div>الطلب: {integration.demandRecords} مقرر · الأفواج: {integration.cohorts} · البلوكات: {integration.blocks} · التعيينات: {integration.assignments}</div>
        <div>سعات البلوكات حسب المستوى: {Object.entries(integration.blockCapacityByLevel).map(([level,value])=>`${level}: ${value}`).join(' · ')}</div>
        {integration.scenarioId?<div>السيناريو: أُنشئ · Timefold: {integration.solverStarted?'بدأ التشغيل':`لم يبدأ — ${integration.solverError??'سبب غير معروف'}`}</div>:
          <div>تعذر إنشاء السيناريو: {integration.scenarioError}</div>}
        <div className="action-links"><a href="/academic">عرض الأفواج والبلوكات</a><a href="/demand">عرض تقدير الطلب</a><a href="/scheduling">عرض السيناريو وTimefold</a></div>
      </div>}
    </section>}
  </section>;
}
