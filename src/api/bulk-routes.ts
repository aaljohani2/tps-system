import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './database.js';
import {requireEditor,allowedDepartment} from './security.js';
import {columns,kinds,previewBulk,decodeCsv,
  type BulkKind,type BulkPreview,type BulkRow,type TrainerBulk,type RoomBulk,
  type BlockBulk,type DemandBulk,type CourseBulk} from '../bulk-import.js';
import {bulkReadXlsx,bulkTemplateXlsx} from '../bulk-xlsx.js';

const uuid=z.string().uuid();
const kindSchema=z.enum(kinds);
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
type Scope={departmentId:string;collegeId:string;termId:string|null};
const getKind=(req:FastifyRequest)=>kindSchema.parse((req.params as {kind:string}).kind);
function hash(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex');}
function userId(req:FastifyRequest){return req.principal!.id;}
async function scope(req:FastifyRequest,kind:BulkKind):Promise<Scope>{
  const v=z.object({departmentId:uuid,termId:uuid.optional(),importId:uuid.optional()}).parse(req.query);
  if(!await allowedDepartment(req.principal!,v.departmentId))throw fail('Scope denied',403);
  const dept=await pool.query<{college_id:string}>('SELECT college_id FROM departments WHERE id=$1',[v.departmentId]);
  if(!dept.rows[0])throw fail('Department not found',404);
  const collegeId=dept.rows[0].college_id;
  if(kind==='rooms' && req.principal!.departmentId && req.principal!.role!=='SYSTEM_ADMIN')
    throw fail('Shared college resources require college-level editor access',403);
  if(['blocks','demand'].includes(kind)){
    if(!v.termId)throw fail('Academic term is required for this import');
    const term=await pool.query('SELECT 1 FROM academic_terms WHERE id=$1 AND college_id=$2',
      [v.termId,collegeId]);
    if(!term.rowCount)throw fail('Term does not belong to selected college');
  }
  return {departmentId:v.departmentId,collegeId,termId:v.termId??null};
}
async function decode(kind:BulkKind,req:FastifyRequest):Promise<{bytes:Buffer;preview:BulkPreview}>{
  if(!Buffer.isBuffer(req.body))throw fail('Upload CSV or XLSX with the correct content-type',415);
  const bytes=req.body as Buffer;
  const media=(String(req.headers['content-type']??'').split(';')[0]??'').toLowerCase();
  let table:string[][];
  try{
    if(media==='text/csv')table=decodeCsv(bytes);
    else if(media==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      table=await bulkReadXlsx(kind,bytes);
    else throw fail('Only CSV and XLSX uploads are supported',415);
    return {bytes,preview:previewBulk(kind,table)};
  }catch(e){
    if((e as {statusCode?:number}).statusCode)throw e;
    throw fail('Invalid '+kind+' file: '+(e instanceof Error?e.message:String(e)).slice(0,320));
  }
}
async function preflight(client:PoolClient,kind:BulkKind,rows:BulkRow[],ctx:Scope):Promise<void>{
  if(kind==='courses'){
    const dept=await client.query<{name:string}>('SELECT name FROM departments WHERE id=$1',[ctx.departmentId]);
    if(!dept.rows[0])throw fail('Department not found',404);
    const actual=dept.rows[0].name;
    for(const row of rows as CourseBulk[])if(row.department!==actual)
      throw fail('Course '+row.code+' belongs to department "'+row.department+'" but selected department is "'+actual+'"',409);
  }else if(kind==='instructors'){
    const dept=await client.query<{name:string}>('SELECT name FROM departments WHERE id=$1',[ctx.departmentId]);
    if(!dept.rows[0])throw fail('Department not found',404);
    for(const row of rows as TrainerBulk[])if(row.department!==dept.rows[0].name)
      throw fail('Trainer '+row.code+' does not belong to the selected department',409);
    const codes=[...new Set(rows.flatMap(v=>(v as TrainerBulk).eligibleCourseCodes??[]))];
    if(codes.length){
      const found=await client.query<{code:string}>(`SELECT code FROM courses
        WHERE department_id=$1 AND code=ANY($2::text[])`,[ctx.departmentId,codes]);
      const actual=new Set(found.rows.map(r=>r.code));
      const missing=codes.filter(v=>!actual.has(v));
      if(missing.length)throw fail('Unknown trainer course eligibility: '+missing.join(', '),409);
    }
  }else if(kind==='blocks'){
    const cohortCodes=[...new Set(rows.map(r=>(r as BlockBulk).cohortCode))];
    const cohorts=await client.query<{id:string;code:string;level:number}>(`
      SELECT id,code,level FROM cohorts WHERE department_id=$1 AND active=true
      AND code=ANY($2::text[])`,[ctx.departmentId,cohortCodes]);
    const known=new Map(cohorts.rows.map(r=>[r.code,r]));
    const courseCodes=[...new Set(rows.flatMap(r=>(r as BlockBulk).courseCodes))];
    const courses=await client.query<{id:string;code:string;level:number}>(`
      SELECT id,code,level FROM courses WHERE department_id=$1 AND code=ANY($2::text[])`,
      [ctx.departmentId,courseCodes]);
    const coursesByCode=new Map(courses.rows.map(c=>[c.code,c]));
    for(const row of rows as BlockBulk[]){
      const cohort=known.get(row.cohortCode);
      if(!cohort)throw fail('Unknown or inactive cohort: '+row.cohortCode,409);
      if(cohort.level!==row.level)throw fail('Uploaded block level disagrees with existing cohort level',409);
      for(const courseCode of row.courseCodes){
        const course=coursesByCode.get(courseCode);
        if(!course)throw fail('Unknown course for block '+row.code+': '+courseCode,409);
        if(course.level!==cohort.level)throw fail('Course '+courseCode+' and cohort '+row.cohortCode+' have different levels',409);
      }
      const existing=await client.query<{course_code:string}>(`
        SELECT c.code AS course_code FROM student_blocks b
        JOIN cohorts co ON co.id=b.cohort_id
        JOIN block_course_assignments a ON a.block_id=b.id AND a.term_id=$4
        JOIN courses c ON c.id=a.course_id
        WHERE co.department_id=$1 AND co.code=$2 AND b.code=$3`,[
        ctx.departmentId,row.cohortCode,row.code,ctx.termId]);
      for(const old of existing.rows)if(!row.courseCodes.includes(old.course_code))
        throw fail('Block '+row.cohortCode+'::'+row.code+' already has course '+old.course_code+
          '; this import will not silently delete that link',409);
    }
  }else if(kind==='demand'){
    const codes=rows.map(r=>(r as DemandBulk).courseCode);
    const current=await client.query<{code:string;level:number}>(`
      SELECT code,level FROM courses WHERE department_id=$1 AND code=ANY($2::text[])`,[
      ctx.departmentId,codes]);
    const map=new Map(current.rows.map(c=>[c.code,c.level]));
    for(const row of rows as DemandBulk[]){
      if(!map.has(row.courseCode))throw fail('Unknown demand course: '+row.courseCode,409);
      if(map.get(row.courseCode)!==row.level)throw fail('Incorrect level for course '+row.courseCode,409);
    }
  }
}
async function save(client:PoolClient,kind:BulkKind,rows:BulkRow[],ctx:Scope,actor:string,activeImportJobId:string){
  let imported=0;
  if(kind==='courses')for(const row of rows as CourseBulk[]){
    // Imported eligibility and delivery mode are proposals only. Never grant privileges
    // to optional modes by uploading a spreadsheet.
    const result=await client.query<{id:string;mode:string;eligible_modes:string[]}>(`
      INSERT INTO courses(department_id,code,title,level,theory_hours,practical_hours,demand,mode,eligible_modes,blocks)
      VALUES($1,$2,$3,$4,$5,$6,$7,'ONSITE','["ONSITE"]'::jsonb,'[]'::jsonb)
      ON CONFLICT(department_id,code) DO UPDATE SET title=EXCLUDED.title,level=EXCLUDED.level,
        theory_hours=EXCLUDED.theory_hours,practical_hours=EXCLUDED.practical_hours,
        demand=EXCLUDED.demand,updated_at=now()
      RETURNING id,mode,eligible_modes`,[
      ctx.departmentId,row.code,row.title,row.level,row.theoryHours,row.practicalHours,row.demand]);
    const approved=result.rows[0]!;
    await client.query(`INSERT INTO course_import_proposals
      (course_id,import_job_id,requested_mode,requested_eligible_modes,requires_approval)
      VALUES($1,$2,$3,$4::jsonb,$5)`,[
      approved.id,activeImportJobId,row.proposedMode,JSON.stringify(row.eligibleModes),
      !approved.eligible_modes.includes(row.proposedMode)||
      row.eligibleModes.some(m=>!approved.eligible_modes.includes(m))]);
    imported++;
  }
  if(kind==='instructors')for(const row of rows as TrainerBulk[]){
    await client.query(`INSERT INTO instructors(department_id,code,name,max_load,
      eligible_course_codes,allowed_modes,available,overload)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,NULL)
      ON CONFLICT(department_id,code) DO UPDATE SET name=EXCLUDED.name,
      max_load=EXCLUDED.max_load,eligible_course_codes=EXCLUDED.eligible_course_codes,
      allowed_modes=EXCLUDED.allowed_modes,available=EXCLUDED.available,updated_at=now()`,[
      ctx.departmentId,row.code,row.name,row.maxLoad,JSON.stringify(row.eligibleCourseCodes),
      JSON.stringify(row.allowedModes),JSON.stringify(row.available)]);
    imported++;
  }
  if(kind==='rooms')for(const row of rows as RoomBulk[]){
    await client.query(`INSERT INTO rooms(college_id,code,name,type,capacity,building,available)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
      ON CONFLICT(college_id,code) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,
        capacity=EXCLUDED.capacity,building=EXCLUDED.building,available=EXCLUDED.available,
        updated_at=now()`,[
      ctx.collegeId,row.code,row.name,row.type,row.capacity,row.building,
      JSON.stringify(row.available)]);
    imported++;
  }
  if(kind==='blocks')for(const row of rows as BlockBulk[]){
    const cohort=await client.query<{id:string}>(`
      SELECT id FROM cohorts WHERE department_id=$1 AND code=$2 AND active=true`,[
      ctx.departmentId,row.cohortCode]);
    const block=await client.query<{id:string}>(`
      INSERT INTO student_blocks(cohort_id,code,name,size) VALUES($1,$2,$3,$4)
      ON CONFLICT(cohort_id,code) DO UPDATE SET name=EXCLUDED.name,size=EXCLUDED.size
      RETURNING id`,[cohort.rows[0]!.id,row.code,row.name,row.size]);
    const codes=await client.query<{id:string}>(`SELECT id FROM courses WHERE department_id=$1
      AND code=ANY($2::text[])`,[ctx.departmentId,row.courseCodes]);
    for(const course of codes.rows)await client.query(`INSERT INTO block_course_assignments
      (block_id,course_id,term_id) VALUES($1,$2,$3)
      ON CONFLICT(block_id,course_id,term_id) DO NOTHING`,[
      block.rows[0]!.id,course.id,ctx.termId]);
    imported++;
  }
  if(kind==='demand')for(const row of rows as DemandBulk[]){
    const course=await client.query<{id:string}>(`SELECT id FROM courses WHERE department_id=$1
      AND code=$2`,[ctx.departmentId,row.courseCode]);
    const projected=Math.ceil(row.baseStudents*(1+row.repeatRate));
    await client.query(`INSERT INTO demand_estimates(course_id,term_id,base_students,repeat_rate,
      projected_students,source,confidence,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(course_id,term_id) DO UPDATE SET base_students=EXCLUDED.base_students,
      repeat_rate=EXCLUDED.repeat_rate,projected_students=EXCLUDED.projected_students,
      source=EXCLUDED.source,confidence=EXCLUDED.confidence,updated_by=EXCLUDED.updated_by,
      updated_at=now()`,[
      course.rows[0]!.id,ctx.termId,row.baseStudents,row.repeatRate,projected,
      row.source,row.confidence,actor]);
    imported++;
  }
  return imported;
}
export async function registerBulkImports(app:FastifyInstance):Promise<void>{
  app.get('/api/v1/import/batch/courses/proposals',async(req)=>{
    const v=z.object({departmentId:uuid}).parse(req.query);
    if(!await allowedDepartment(req.principal!,v.departmentId))throw fail('Scope denied',403);
    return (await pool.query(`SELECT p.id,p.course_id,c.code,c.title,p.requested_mode,
        p.requested_eligible_modes,p.requires_approval,p.created_at,
        c.mode AS current_mode,c.eligible_modes AS approved_eligible_modes,
        j.status AS import_status
      FROM course_import_proposals p
      JOIN courses c ON c.id=p.course_id
      JOIN import_jobs j ON j.id=p.import_job_id
      WHERE c.department_id=$1 AND j.status='COMMITTED'
      ORDER BY p.created_at DESC LIMIT 200`,[v.departmentId])).rows;
  });
  app.get('/api/v1/import/batch/:kind/template.csv',async(req,reply)=>{
    const kind=getKind(req);
    const headers=columns[kind].join(',')+'\r\n';
    reply.header('content-type','text/csv; charset=utf-8');
    reply.header('content-disposition','attachment; filename="tps-'+kind+'-template.csv"');
    return '\uFEFF'+headers;
  });
  app.get('/api/v1/import/batch/:kind/template.xlsx',async(req,reply)=>{
    const kind=getKind(req);
    const data=await bulkTemplateXlsx(kind);
    reply.header('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition','attachment; filename="tps-'+kind+'-template.xlsx"');
    return reply.send(data);
  });
  app.post('/api/v1/import/batch/:kind/preview',async(req)=>{
    requireEditor(req);
    const kind=getKind(req),ctx=await scope(req,kind);
    const {bytes,preview}=await decode(kind,req);
    if(!preview.ready)return {...preview,importId:null};
    const client=await pool.connect();
    try{await preflight(client,kind,preview.rows,ctx);}
    catch(e){return {...preview,ready:false,importId:null,
      errors:[...preview.errors,{row:0,message:String(e instanceof Error?e.message:e).slice(0,350)}]};}
    finally{client.release();}
    const job=await pool.query<{id:string}>(`INSERT INTO import_jobs
      (kind,department_id,college_id,term_id,created_by,file_sha256,row_count)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[
      kind,ctx.departmentId,ctx.collegeId,ctx.termId,userId(req),
      hash(bytes),preview.rows.length]);
    return {...preview,importId:job.rows[0]!.id};
  });
  app.post('/api/v1/import/batch/:kind/commit',async(req)=>{
    requireEditor(req);
    const kind=getKind(req),ctx=await scope(req,kind);
    const importId=uuid.parse((req.query as {importId?:string}).importId);
    const {bytes,preview}=await decode(kind,req);
    if(!preview.ready)throw fail('File failed validation. Review all rows before committing.',409);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const locked=await client.query<{kind:string;department_id:string;college_id:string;
        term_id:string|null;created_by:string;file_sha256:string;status:string;row_count:number;expired:boolean}>(`
        SELECT kind,department_id,college_id,term_id,created_by,file_sha256,status,row_count,
          expires_at<now() AS expired FROM import_jobs WHERE id=$1 FOR UPDATE`,[importId]);
      const job=locked.rows[0];
      if(!job||job.created_by!==userId(req)||job.kind!==kind||
        job.department_id!==ctx.departmentId||job.college_id!==ctx.collegeId||
        job.term_id!==ctx.termId)throw fail('Preview not found or not owned by this scope',403);
      if(job.status!=='PREVIEWED'||job.expired)throw fail('Preview already committed or expired',409);
      if(job.file_sha256!==hash(bytes)||job.row_count!==preview.rows.length)
        throw fail('Uploaded file changed since its preview. Preview again.',409);
      await preflight(client,kind,preview.rows,ctx);
      const imported=await save(client,kind,preview.rows,ctx,userId(req),importId);
      await client.query(`UPDATE import_jobs SET status='COMMITTED',committed_at=now() WHERE id=$1`,[importId]);
      await client.query(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
        VALUES($1,'BULK_IMPORT',$2,$3,$4::jsonb)`,[
        userId(req),kind.toUpperCase(),importId,JSON.stringify({rows:imported,
          departmentId:ctx.departmentId,termId:ctx.termId})
      ]);
      await client.query('COMMIT');
      return {importId,kind,status:'COMMITTED',imported};
    }catch(e){await client.query('ROLLBACK');throw e;}
    finally{client.release();}
  });
}
