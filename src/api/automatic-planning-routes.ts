import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {allowedDepartment,requireEditor} from './security.js';
import {pool} from './database.js';
import {calculateAutomaticPlan,extractHistoricalCapacities,extractHistoricalCourseSettings,extractHistoricalLevelCounts,
  extractInstructorDirectory,extractTableMetadata,extractTraineeDemand,importAutomaticCurriculumCsv,normalizeArabic,normalizeCourseCode,resolveLevelDemand,
  type AutomaticCurriculum,type CapacitySettings,type LevelDemandInput,
  type OperationalCourseSetting} from '../automatic-planning.js';
import {readAutomaticWorkbook,type WorkbookTable} from '../automatic-xlsx.js';
import {getEffectivePolicy} from './policies.js';
import {createScenarioDraft} from './scenarios.js';
import type {Policy} from '../types.js';

const uuid=z.string().uuid();
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
async function checkScope(req:FastifyRequest){
  const {departmentId}=z.object({departmentId:uuid}).passthrough().parse(req.query);
  if(!await allowedDepartment(req.principal!,departmentId))throw fail('Scope denied',403);
}
function scopeId(req:FastifyRequest){return uuid.parse((req.query as {departmentId?:string}).departmentId);}
function asBuffer(req:FastifyRequest):Buffer{
  if(!Buffer.isBuffer(req.body))throw fail('Upload CSV or XLSX with the correct content type',415);
  return req.body as Buffer;
}
function tableCsv(table:string[][]):string{
  return table.map(row=>row.map(value=>/[",\r\n]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value).join(',')).join('\r\n');
}
async function tables(req:FastifyRequest):Promise<WorkbookTable[]>{
  const bytes=asBuffer(req),media=String(req.headers['content-type']??'').split(';')[0]?.toLowerCase();
  if(media==='text/csv')return [{name:'CSV',rows:tableCsvToRows(bytes.toString('utf8'))}];
  if(media==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')return readAutomaticWorkbook(bytes);
  throw fail('Only CSV and XLSX uploads are supported',415);
}
function tableCsvToRows(raw:string):string[][]{
  // Reuse the hardened CSV parser indirectly by importing the plan, while retaining
  // this table only for historical-count discovery.
  const parsed:string[][]=[];let row:string[]=[],cell='',quoted=false;
  const text=raw.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const ch=text[i]!;
    if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}
    else if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell='';}
    else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))parsed.push(row);row=[];cell='';
      if(parsed.length>100_001)throw fail('CSV exceeds 100000 data rows',413);}
    else cell+=ch;
  }
  if(quoted)throw fail('Unclosed CSV quote');if(row.length||cell){row.push(cell);if(row.some(x=>x.trim()))parsed.push(row);}
  if(parsed.some(values=>values.length>200))throw fail('CSV exceeds 200 columns',413);
  return parsed;
}
function findPlan(all:WorkbookTable[]){
  const errors:string[]=[];
  for(const sheet of all)try{return {sheet:sheet.name,curriculum:importAutomaticCurriculumCsv(tableCsv(sheet.rows))};}
    catch(e){errors.push(`${sheet.name}: ${e instanceof Error?e.message:String(e)}`);}
  throw fail('No worksheet contains a recognizable curriculum plan. '+errors.slice(0,3).join(' | '));
}
function findCounts(all:WorkbookTable[],courseLevels:Record<string,number>={}){
  const errors:string[]=[];
  for(const sheet of all)try{
    const extracted=extractHistoricalLevelCounts(sheet.rows);
    if(Object.keys(extracted.counts).length){
      let scenario:{settings:OperationalCourseSetting[];courseCount:number;warnings:string[]}={settings:[],courseCount:0,warnings:[]};
      try{scenario=extractHistoricalCourseSettings(sheet.rows);}catch{/* counts remain independently usable */}
      const capacities=all.map(candidate=>extractHistoricalCapacities(candidate.rows)).find(Boolean)??null;
      return {sheet:sheet.name,...extracted,metadata:extractTableMetadata(sheet.rows),settings:scenario.settings,courseCount:scenario.courseCount,capacities,
        detection:{kind:'LEVEL_COUNTS',strategy:'AGGREGATED_COUNTS'},warnings:[...extracted.warnings,...scenario.warnings]};
    }
  }catch(e){errors.push(`${sheet.name}: ${e instanceof Error?e.message:String(e)}`);}
  for(const sheet of all)try{
    const extracted=extractTraineeDemand(sheet.rows,courseLevels);
    const capacities=all.map(candidate=>extractHistoricalCapacities(candidate.rows)).find(Boolean)??null;
    return {sheet:sheet.name,counts:extracted.counts,metadata:extractTableMetadata(sheet.rows),warnings:extracted.warnings,settings:[],
      courseCount:Object.keys(extracted.courseCounts).length,capacities,courseCounts:extracted.courseCounts,
      detection:{kind:extracted.sourceKind,strategy:extracted.strategy,uniqueTrainees:extracted.uniqueTrainees,
        matchedTrainees:extracted.matchedTrainees,matchedRows:extracted.matchedRows,ignoredRows:extracted.ignoredRows,
        unmatchedCourseRows:extracted.unmatchedCourseRows,
        traineesAcrossMultipleLevels:extracted.traineesAcrossMultipleLevels}};
  }catch(e){errors.push(`${sheet.name}: ${e instanceof Error?e.message:String(e)}`);}
  throw fail('No worksheet contains consistent level learner counts. '+errors.slice(0,3).join(' | '));
}

function findInstructors(all:WorkbookTable[],targetDepartment:string){
  const errors:string[]=[],candidates:Array<{sheet:string;metadata:ReturnType<typeof extractTableMetadata>;
    instructors:ReturnType<typeof extractInstructorDirectory>['instructors'];warnings:string[]}>=[];
  for(const sheet of all)try{candidates.push({sheet:sheet.name,...extractInstructorDirectory(sheet.rows,targetDepartment)});}
    catch(e){errors.push(`${sheet.name}: ${e instanceof Error?e.message:String(e)}`);}
  candidates.sort((a,b)=>{
    const aLinks=a.instructors.reduce((n,v)=>n+v.eligibleCourseCodes.length,0);
    const bLinks=b.instructors.reduce((n,v)=>n+v.eligibleCourseCodes.length,0);
    return bLinks-aLinks||b.instructors.length-a.instructors.length;
  });
  const selected=candidates[0];
  if(!selected)throw fail('No worksheet contains a recognizable instructor directory. '+errors.slice(0,3).join(' | '));
  return selected;
}

function requestCourseLevels(req:FastifyRequest):Record<string,number>{
  const raw=(req.query as {courseLevels?:unknown}).courseLevels;
  if(raw===undefined||raw==='')return {};
  if(typeof raw!=='string'||raw.length>50_000)throw fail('Curriculum course-level mapping is too large');
  let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw fail('Invalid curriculum course-level mapping');}
  const value=z.record(z.string().min(1).max(120),z.number().int().min(1).max(12)).parse(parsed);
  if(Object.keys(value).length>1000)throw fail('Curriculum course-level mapping exceeds 1000 courses');
  return value;
}

type StoredPlanCourse={
  plan_id:string;plan_code:string;version_label:string;program_id:string;program_code:string;department_id:string;
  course_id:string;course_code:string;title:string;level:number;mode:'ONSITE'|'REMOTE'|'SELF_PACED'|'HYBRID';
  source_code:string;normalized_code:string;theory_hours:string|number;practical_hours:string|number;
  tutorial_hours:string|number;credits:string|number|null;prerequisites:string[];equivalents:string[];
  responsible_department:string|null;alternative_group:string|null;
  special_kind:'REGULAR'|'COOPERATIVE_TRAINING'|'PRODUCTION_PROJECT';source_row:number;
};
function curriculumFromRows(rows:StoredPlanCourse[],metadata:Record<string,string>):AutomaticCurriculum{
  const courses=rows.map(row=>({code:row.source_code,normalizedCode:row.normalized_code,title:row.title,level:row.level,
    theoryHours:Number(row.theory_hours),practicalHours:Number(row.practical_hours),tutorialHours:Number(row.tutorial_hours),
    credits:row.credits===null?null:Number(row.credits),prerequisites:row.prerequisites??[],equivalents:row.equivalents??[],
    responsibleDepartment:row.responsible_department,alternativeGroup:row.alternative_group,specialKind:row.special_kind,
    sourceRow:row.source_row}));
  const levels=[...new Set(courses.map(course=>course.level))].sort((a,b)=>a-b)
    .map(level=>({level,courses:courses.filter(course=>course.level===level)}));
  return {schemaVersion:'tps.automatic-curriculum.v1',metadata,levels,courses,sourceRows:courses.length,warnings:[]};
}
function courseCapacity(row:StoredPlanCourse,policy:Policy):number|null{
  if(row.mode==='SELF_PACED')return null;
  const cap=policy.capacities[row.mode];
  const theory=Number(row.theory_hours)+Number(row.tutorial_hours),practical=Number(row.practical_hours);
  if(theory>0&&practical>0)return Math.min(cap.theory??Infinity,cap.practical??Infinity);
  return theory>0?cap.theory:cap.practical;
}
function safeCode(value:string){return value.replace(/[^A-Za-z0-9_-]/g,'').slice(0,60);}

export async function registerAutomaticPlanning(app:FastifyInstance){
  app.post('/api/v1/automatic-planning/plan/preview',async req=>{
    requireEditor(req);await checkScope(req);
    try{return findPlan(await tables(req));}catch(e){if((e as {statusCode?:number}).statusCode)throw e;
      throw fail(e instanceof Error?e.message:String(e));}
  });
  app.post('/api/v1/automatic-planning/history/preview',{bodyLimit:20*1024*1024},async req=>{
    requireEditor(req);await checkScope(req);
    try{return findCounts(await tables(req),requestCourseLevels(req));}catch(e){if((e as {statusCode?:number}).statusCode)throw e;
      throw fail(e instanceof Error?e.message:String(e));}
  });
  app.post('/api/v1/automatic-planning/resources/preview',{bodyLimit:20*1024*1024},async req=>{
    requireEditor(req);await checkScope(req);
    const departmentId=scopeId(req);
    const department=await pool.query<{name:string}>('SELECT name FROM departments WHERE id=$1',[departmentId]);
    if(!department.rows[0])throw fail('Department not found',404);
    const bytes=asBuffer(req),preview=findInstructors(await tables(req),department.rows[0].name);
    const linked=preview.instructors.filter(v=>v.eligibleCourseCodes.length>0).length;
    return {sheet:preview.sheet,metadata:preview.metadata,instructors:preview.instructors.length,
      courseLinkedInstructors:linked,sourceRows:preview.instructors.reduce((n,v)=>n+v.sourceRows,0),
      warnings:preview.warnings,ready:linked>0,sha256:createHash('sha256').update(bytes).digest('hex')};
  });
  app.post('/api/v1/automatic-planning/resources/commit',{bodyLimit:20*1024*1024},async req=>{
    requireEditor(req);await checkScope(req);
    const query=z.object({departmentId:uuid,expectedSha256:z.string().regex(/^[a-f0-9]{64}$/),
      defaultMaxLoad:z.coerce.number().positive().max(200)}).parse(req.query);
    const bytes=asBuffer(req),actualHash=createHash('sha256').update(bytes).digest('hex');
    if(actualHash!==query.expectedSha256)throw fail('Resource file changed after preview. Preview it again.',409);
    const department=await pool.query<{name:string}>('SELECT name FROM departments WHERE id=$1',[query.departmentId]);
    if(!department.rows[0])throw fail('Department not found',404);
    const preview=findInstructors(await tables(req),department.rows[0].name);
    const discoveredCodes=[...new Set(preview.instructors.flatMap(v=>v.eligibleCourseCodes))];
    const known=discoveredCodes.length?await pool.query<{code:string}>('SELECT code FROM courses WHERE department_id=$1 AND code=ANY($2::text[])',
      [query.departmentId,discoveredCodes]):{rows:[] as Array<{code:string}>};
    const knownCodes=new Set(known.rows.map(v=>v.code));
    const client=await pool.connect();let imported=0,skipped=0;
    try{
      await client.query('BEGIN');
      for(const trainer of preview.instructors){
        const eligibility=trainer.eligibleCourseCodes.filter(code=>knownCodes.has(code));
        if(!eligibility.length){skipped++;continue;}
        await client.query(`INSERT INTO instructors(department_id,code,name,max_load,eligible_course_codes,allowed_modes,available,overload)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,NULL,NULL)
          ON CONFLICT(department_id,code) DO UPDATE SET name=EXCLUDED.name,
            eligible_course_codes=EXCLUDED.eligible_course_codes,allowed_modes=EXCLUDED.allowed_modes,updated_at=now()`,[
          query.departmentId,trainer.code,trainer.name,trainer.maxLoad??query.defaultMaxLoad,
          JSON.stringify(eligibility),JSON.stringify(trainer.allowedModes)]);
        imported++;
      }
      if(!imported)throw fail('No instructor row could be linked to a course in the selected department',409);
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'SMART_RESOURCE_IMPORT','INSTRUCTOR_DIRECTORY',$2,$3::jsonb)`,[
        req.principal!.id,query.departmentId,JSON.stringify({sha256:actualHash,imported,skipped,sheet:preview.sheet})]);
      await client.query('COMMIT');
      return {status:'COMMITTED',imported,skipped,warnings:preview.warnings};
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  });
  app.post('/api/v1/automatic-planning/plan/commit',async req=>{
    requireEditor(req);await checkScope(req);
    const query=z.object({departmentId:uuid,programId:uuid,planCode:z.string().trim().min(1).max(60),
      versionLabel:z.string().trim().min(1).max(120)}).parse(req.query);
    const owner=await pool.query<{department_id:string}>('SELECT department_id FROM training_programs WHERE id=$1',[query.programId]);
    if(!owner.rows[0])throw fail('Training program not found',404);
    if(owner.rows[0].department_id!==scopeId(req))throw fail('Program does not belong to selected department',409);
    const bytes=asBuffer(req),preview=findPlan(await tables(req));
    const department=await pool.query<{name:string}>('SELECT name FROM departments WHERE id=$1',[query.departmentId]);
    if(!department.rows[0])throw fail('Department not found',404);
    const detectedDepartment=preview.curriculum.metadata.department;
    if(detectedDepartment&&normalizeArabic(detectedDepartment)!==normalizeArabic(department.rows[0].name)){
      throw fail(`The uploaded plan belongs to department "${detectedDepartment}", not the selected department`,409);
    }
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const previous=await client.query<{id:string}>(`SELECT id FROM curriculum_plans WHERE program_id=$1
        ORDER BY created_at DESC LIMIT 1`,[query.programId]);
      const plan=await client.query<{id:string}>(`INSERT INTO curriculum_plans(program_id,code,version_label,state)
        VALUES($1,$2,$3,'DRAFT') RETURNING id`,[query.programId,query.planCode,query.versionLabel]);
      const planId=plan.rows[0]!.id;
      for(const course of preview.curriculum.courses){
        const nonTimed=course.theoryHours+course.tutorialHours+course.practicalHours===0;
        const saved=await client.query<{id:string}>(`INSERT INTO courses
          (department_id,code,title,level,theory_hours,practical_hours,demand,mode,eligible_modes,blocks,is_non_timetabled)
          VALUES($1,$2,$3,$4,$5,$6,0,'ONSITE','["ONSITE"]'::jsonb,'[]'::jsonb,$7)
          ON CONFLICT(department_id,code) DO UPDATE SET title=EXCLUDED.title,level=EXCLUDED.level,
            theory_hours=EXCLUDED.theory_hours,practical_hours=EXCLUDED.practical_hours,
            is_non_timetabled=EXCLUDED.is_non_timetabled,updated_at=now() RETURNING id`,[
          query.departmentId,course.normalizedCode,course.title,course.level,
          course.theoryHours+course.tutorialHours,course.practicalHours,nonTimed]);
        const item=await client.query<{id:string}>(`INSERT INTO curriculum_items(plan_id,course_id,level,is_required)
          VALUES($1,$2,$3,$4) RETURNING id`,[planId,saved.rows[0]!.id,course.level,!course.alternativeGroup]);
        await client.query(`INSERT INTO curriculum_item_details
          (curriculum_item_id,source_code,normalized_code,theory_hours,practical_hours,tutorial_hours,credits,
           prerequisites,equivalents,responsible_department,alternative_group,special_kind,source_row)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)`,[
          item.rows[0]!.id,course.code,course.normalizedCode,course.theoryHours,course.practicalHours,
          course.tutorialHours,course.credits,JSON.stringify(course.prerequisites),JSON.stringify(course.equivalents),
          course.responsibleDepartment,course.alternativeGroup,course.specialKind,course.sourceRow]);
      }
      await client.query(`INSERT INTO curriculum_plan_sources
        (plan_id,source_sha256,source_sheet,metadata,summary,imported_by)
        VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,[planId,createHash('sha256').update(bytes).digest('hex'),
        preview.sheet,JSON.stringify(preview.curriculum.metadata),JSON.stringify({levels:preview.curriculum.levels.length,
          records:preview.curriculum.courses.length,warnings:preview.curriculum.warnings}),req.principal!.id]);
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'IMPORT_VERSION','CURRICULUM_PLAN',$2,$3::jsonb)`,[req.principal!.id,planId,
        JSON.stringify({programId:query.programId,planCode:query.planCode,records:preview.curriculum.courses.length,
          previousPlanId:previous.rows[0]?.id??null})]);
      await client.query('COMMIT');
      return {planId,state:'DRAFT',previousPlanId:previous.rows[0]?.id??null,
        levels:preview.curriculum.levels.length,records:preview.curriculum.courses.length};
    }catch(error){
      await client.query('ROLLBACK');
      if((error as {code?:string}).code==='23505')throw fail('Plan code already exists. Use a new version code; existing plans are never overwritten.',409);
      throw error;
    }finally{client.release();}
  });
  app.post('/api/v1/automatic-planning/calculate',async req=>{
    requireEditor(req);await checkScope(req);
    const body=z.object({curriculum:z.unknown(),sources:z.array(z.unknown()),capacities:z.object({
      remoteTheory:z.number().int().positive(),onsiteTheory:z.number().int().positive(),
      practical:z.number().int().positive(),mixed:z.number().int().positive()}),
      settings:z.array(z.unknown()).default([]),alternativeSelections:z.record(z.string(),z.string()).default({})}).parse(req.body);
    // The preview endpoint is the canonical producer. Core calculation validates all
    // numeric capacities and treats missing level sources as incomplete, never as zero demand.
    const curriculum=body.curriculum as AutomaticCurriculum;
    const demand=resolveLevelDemand(curriculum.levels.map(level=>level.level),body.sources as LevelDemandInput[]).levels;
    return calculateAutomaticPlan(curriculum,demand,body.capacities as CapacitySettings,
      body.settings as OperationalCourseSetting[],body.alternativeSelections);
  });
  app.post('/api/v1/automatic-planning/materialize',async req=>{
    requireEditor(req);await checkScope(req);
    const query=z.object({departmentId:uuid}).parse(req.query);
    const sourceSchema=z.object({kind:z.enum(['ACTUAL_LEVEL_COUNTS','COURSE_REGISTRATIONS','HISTORICAL_WORKBOOK','LEVEL_TRANSITION']),
      counts:z.record(z.string(),z.number().int().min(0).max(7500)),label:z.string().trim().min(1).max(240),
      confidence:z.enum(['LOW','MEDIUM','HIGH']),sourceTermId:z.string().optional(),targetTermId:z.string().optional(),
      recordedAt:z.string().optional(),isConfirmedForTarget:z.boolean().optional()}).passthrough();
    const body=z.object({planId:uuid,termId:uuid,scenarioName:z.string().trim().min(1).max(160),
      sources:z.array(sourceSchema).min(1).max(8),capacities:z.object({remoteTheory:z.number().int().positive(),
        onsiteTheory:z.number().int().positive(),practical:z.number().int().positive(),mixed:z.number().int().positive()}),
      settings:z.array(z.unknown()).default([]),alternativeSelections:z.record(z.string(),z.string()).default({})}).parse(req.body);
    const owner=await pool.query<{department_id:string}>(`SELECT p.department_id FROM curriculum_plans cp
      JOIN training_programs p ON p.id=cp.program_id WHERE cp.id=$1`,[body.planId]);
    if(!owner.rows[0])throw fail('Plan not found',404);
    if(owner.rows[0].department_id!==query.departmentId)throw fail('Plan does not belong to selected department',409);
    const term=await pool.query<{code:string}>(`SELECT t.code FROM academic_terms t JOIN departments d ON d.college_id=t.college_id
      WHERE t.id=$1 AND d.id=$2`,[body.termId,query.departmentId]);
    if(!term.rows[0])throw fail('Term does not belong to selected department college',409);
    const {policy}=await getEffectivePolicy(query.departmentId,body.termId);
    const client=await pool.connect();
    let summary:{programId:string;demandRecords:number;cohorts:number;blocks:number;assignments:number;
      blockCapacityByLevel:Record<number,number>};
    try{
      await client.query('BEGIN');
      const rows=await client.query<StoredPlanCourse>(`SELECT cp.id AS plan_id,cp.code AS plan_code,cp.version_label,
        tp.id AS program_id,tp.code AS program_code,tp.department_id,c.id AS course_id,c.code AS course_code,c.title,
        ci.level,c.mode,d.source_code,d.normalized_code,d.theory_hours,d.practical_hours,d.tutorial_hours,d.credits,
        d.prerequisites,d.equivalents,d.responsible_department,d.alternative_group,d.special_kind,d.source_row
        FROM curriculum_plans cp JOIN training_programs tp ON tp.id=cp.program_id
        JOIN curriculum_items ci ON ci.plan_id=cp.id JOIN courses c ON c.id=ci.course_id
        JOIN curriculum_item_details d ON d.curriculum_item_id=ci.id WHERE cp.id=$1
        ORDER BY ci.level,c.code FOR UPDATE OF cp`,[body.planId]);
      if(!rows.rows.length)throw fail('Saved plan has no detailed curriculum items',409);
      const plan=rows.rows[0]!;
      const sourceMeta=await client.query<{metadata:Record<string,string>}>(
        'SELECT metadata FROM curriculum_plan_sources WHERE plan_id=$1',[body.planId]);
      const curriculum=curriculumFromRows(rows.rows,sourceMeta.rows[0]?.metadata??{});
      const resolved=resolveLevelDemand(curriculum.levels.map(level=>level.level),body.sources as LevelDemandInput[]);
      const calculation=calculateAutomaticPlan(curriculum,resolved.levels,body.capacities as CapacitySettings,
        body.settings as OperationalCourseSetting[],body.alternativeSelections);
      if(resolved.missing.length||calculation.missingInputs.length)
        throw fail('Automatic calculation still has missing inputs or unapproved decisions: '+calculation.missingInputs.join(', '),409);
      const selected=new Map(calculation.courses.map(course=>[normalizeCourseCode(course.code),course]));
      const storedByCode=new Map(rows.rows.map(row=>[row.normalized_code,row]));
      const marker=`TPS_AUTO:${body.planId}`;
      // Re-importing a plan must not silently rebuild its live cohort/block links
      // after an associated scenario has entered review, approval or an active solve.
      // Previous scenario snapshots remain immutable, but their live block identities
      // are still operational references. Require an explicit new plan version.
      const protectedScenario=await client.query<{id:string;state:string;solver_status:string}>(`
        SELECT s.id,s.state,s.solver_status FROM scenarios s
        JOIN audit_logs a ON a.entity_type='SCENARIO'
          AND a.action='CREATE_FROM_AUTOMATIC_PLAN' AND a.entity_id=s.id::text
        WHERE s.department_id=$1 AND s.term_id=$2
          AND a.details->>'planId'=$3
          AND (s.state<>'DRAFT' OR s.solver_status IN ('RUNNING','QUEUED'))
        LIMIT 1`,[query.departmentId,body.termId,body.planId]);
      if(protectedScenario.rows[0])throw fail(
        'This imported plan is already linked to a scenario under review, approved, archived or being solved. Create a new plan version; existing cohort/block records were not changed.',409);
      const existingManual=await client.query(`SELECT c.code FROM demand_estimates de JOIN courses c ON c.id=de.course_id
        JOIN curriculum_items ci ON ci.course_id=c.id AND ci.plan_id=$1
        WHERE de.term_id=$2 AND de.source<>$3 LIMIT 1`,[body.planId,body.termId,marker]);
      if(existingManual.rows[0])throw fail(`Demand for ${existingManual.rows[0].code} was entered outside this automatic plan; reconcile it before replacing data`,409);
      const cohortPrefix=safeCode(`AUTO-${body.planId.slice(0,8)}-${body.termId.slice(0,8)}-`);
      const oldCohorts=await client.query<{id:string}>(`SELECT id FROM cohorts WHERE department_id=$1 AND program_id=$2
        AND code LIKE $3`,[query.departmentId,plan.program_id,cohortPrefix+'%']);
      const oldIds=oldCohorts.rows.map(row=>row.id);
      if(oldIds.length){
        const foreignAssignments=await client.query(`SELECT 1 FROM block_course_assignments a JOIN student_blocks b ON b.id=a.block_id
          WHERE b.cohort_id=ANY($1::uuid[]) AND a.term_id<>$2 LIMIT 1`,[oldIds,body.termId]);
        if(foreignAssignments.rowCount)throw fail('Existing automatic blocks are used by another term and cannot be replaced',409);
        await client.query(`DELETE FROM block_course_assignments a USING student_blocks b
          WHERE a.block_id=b.id AND b.cohort_id=ANY($1::uuid[])`,[oldIds]);
        await client.query('DELETE FROM student_blocks WHERE cohort_id=ANY($1::uuid[])',[oldIds]);
        await client.query('DELETE FROM cohorts WHERE id=ANY($1::uuid[])',[oldIds]);
      }
      await client.query(`DELETE FROM demand_estimates de USING curriculum_items ci
        WHERE ci.plan_id=$1 AND de.course_id=ci.course_id AND de.term_id=$2 AND de.source=$3`,[body.planId,body.termId,marker]);
      await client.query(`DELETE FROM level_demand_sources WHERE program_id=$1 AND term_id=$2
        AND source_label LIKE $3`,[plan.program_id,body.termId,marker+'%']);
      for(const level of resolved.levels)await client.query(`INSERT INTO level_demand_sources
        (program_id,term_id,level,students,source_kind,source_label,confidence,is_historical,recorded_at,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[plan.program_id,body.termId,level.level,level.students,
        level.kind,`${marker}:${level.sourceLabel}`,level.confidence,level.historical,level.recordedAt??null,req.principal!.id]);
      let demandRecords=0,cohortCount=0,blockCount=0,assignmentCount=0;
      for(const course of calculation.courses){
        const row=storedByCode.get(normalizeCourseCode(course.code));if(!row)continue;
        const notes=`احتساب آلي من ${course.demandSource}; خطة ${plan.plan_code}`;
        await client.query(`INSERT INTO demand_estimates
          (course_id,term_id,base_students,repeat_rate,projected_students,source,confidence,notes,updated_by)
          VALUES($1,$2,$3,0,$3,$4,$5,$6,$7)`,[row.course_id,body.termId,course.demand,marker,course.confidence,notes,req.principal!.id]);
        await client.query('UPDATE courses SET demand=$2,updated_at=now() WHERE id=$1',[row.course_id,course.demand]);
        demandRecords++;
      }
      const blockCapacityByLevel:Record<number,number>={};
      for(const levelDemand of resolved.levels){
        if(levelDemand.students<=0)continue;
        const timedRows=rows.rows.filter(row=>{
          const calculated=selected.get(row.normalized_code);
          return row.level===levelDemand.level&&!!calculated&&calculated.mode!==null&&
            Number(row.theory_hours)+Number(row.tutorial_hours)+Number(row.practical_hours)>0;
        });
        const limits=timedRows.map(row=>courseCapacity(row,policy)).filter((value):value is number=>value!==null&&Number.isFinite(value)&&value>0);
        const fallback=Object.values(policy.capacities).flatMap(cap=>[cap.theory,cap.practical])
          .filter((value):value is number=>value!==null&&Number.isFinite(value)&&value>0);
        const availableLimits=limits.length?limits:fallback;
        if(!availableLimits.length)throw fail(`No approved capacity is available for level ${levelDemand.level}`,409);
        const safeCapacity=Math.floor(Math.min(...availableLimits));
        if(!safeCapacity)throw fail(`No approved positive capacity is available for level ${levelDemand.level}`,409);
        blockCapacityByLevel[levelDemand.level]=safeCapacity;
        const cohortCode=safeCode(`${cohortPrefix}L${levelDemand.level}`);
        const cohort=await client.query<{id:string}>(`INSERT INTO cohorts(department_id,program_id,code,name,level)
          VALUES($1,$2,$3,$4,$5) RETURNING id`,[query.departmentId,plan.program_id,cohortCode,
          `تخطيط آلي — ${plan.version_label} — المستوى ${levelDemand.level}`,levelDemand.level]);
        cohortCount++;
        const sizes=Array.from({length:Math.ceil(levelDemand.students/safeCapacity)},(_,index)=>
          Math.min(safeCapacity,levelDemand.students-index*safeCapacity));
        for(const [index,size] of sizes.entries()){
          const block=await client.query<{id:string}>(`INSERT INTO student_blocks(cohort_id,code,name,size)
            VALUES($1,$2,$3,$4) RETURNING id`,[cohort.rows[0]!.id,`B${String(index+1).padStart(2,'0')}`,
            `المستوى ${levelDemand.level} — بلوك ${index+1}`,size]);
          blockCount++;
          for(const row of timedRows){
            await client.query(`INSERT INTO block_course_assignments(block_id,course_id,term_id)
              VALUES($1,$2,$3)`,[block.rows[0]!.id,row.course_id,body.termId]);assignmentCount++;
          }
        }
      }
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'MATERIALIZE_AUTOMATIC_PLAN','CURRICULUM_PLAN',$2,$3::jsonb)`,[req.principal!.id,body.planId,
        JSON.stringify({termId:body.termId,demandRecords,cohorts:cohortCount,blocks:blockCount,assignments:assignmentCount})]);
      await client.query('COMMIT');
      summary={programId:plan.program_id,demandRecords,cohorts:cohortCount,blocks:blockCount,
        assignments:assignmentCount,blockCapacityByLevel};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    let scenario:null|Awaited<ReturnType<typeof createScenarioDraft>>=null,scenarioError:string|null=null;
    try{
      scenario=await createScenarioDraft(query.departmentId,body.termId,body.scenarioName,req.principal!.id);
      await pool.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'CREATE_FROM_AUTOMATIC_PLAN','SCENARIO',$2,$3::jsonb)`,[req.principal!.id,scenario.id,
        JSON.stringify({planId:body.planId,termId:body.termId})]);
    }catch(error){scenarioError=error instanceof Error?error.message:String(error);}
    return {...summary,scenarioId:scenario?.id??null,scenario:scenario?{state:scenario.state,solverStatus:scenario.solverStatus,
      metrics:scenario.result.metrics,gaps:scenario.result.gaps.length}:null,scenarioError,
      notice:'Blocks use the smallest approved capacity in each level so cohort conflicts remain enforceable; larger theory groups are not merged automatically.'};
  });
}
