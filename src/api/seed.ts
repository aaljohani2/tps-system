import {pool} from './database.js';

/** Idempotent, opt-in, synthetic-only fixture for isolated local development databases.
 * Never seeds credentials or touches real institution/trainee records.
 */
async function main():Promise<void>{
  if(process.env.TPS_ALLOW_SYNTHETIC_SEED!=='1')
    throw new Error('Synthetic seeding disabled. Set TPS_ALLOW_SYNTHETIC_SEED=1 only for an isolated local testing database.');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(4471729)');
    const institution=await client.query<{id:string}>(`
      INSERT INTO institutions(name) VALUES('TPS DEMO — مؤسسة اصطناعية')
      ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
    const institutionId=institution.rows[0]!.id;
    const college=await client.query<{id:string}>(`
      INSERT INTO colleges(institution_id,name) VALUES($1,'كلية تجريبية — بيانات غير حقيقية')
      ON CONFLICT(institution_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[institutionId]);
    const collegeId=college.rows[0]!.id;
    const department=await client.query<{id:string}>(`
      INSERT INTO departments(college_id,name) VALUES($1,'قسم تجريبي للجدولة')
      ON CONFLICT(college_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[collegeId]);
    const departmentId=department.rows[0]!.id;
    const term=await client.query<{id:string}>(`
      INSERT INTO academic_terms(college_id,code,label,starts_on,ends_on,is_active)
      VALUES($1,'TPS-DEMO-2027','فصل اصطناعي 2027','2027-01-01','2027-04-30',false)
      ON CONFLICT(college_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,[collegeId]);
    const termId=term.rows[0]!.id;
    const program=await client.query<{id:string}>(`
      INSERT INTO training_programs(department_id,code,name) VALUES($1,'TPS-DEMO','برنامج تجريبي فقط')
      ON CONFLICT(department_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,[departmentId]);
    const plan=await client.query<{id:string}>(`
      INSERT INTO curriculum_plans(program_id,code,version_label)
      VALUES($1,'TPS-DEMO-V1','نسخة بيانات اصطناعية')
      ON CONFLICT(program_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,[program.rows[0]!.id]);
    const course=await client.query<{id:string}>(`
      INSERT INTO courses(department_id,code,title,level,theory_hours,practical_hours,demand,
        mode,eligible_modes,blocks,exclusive_instructor)
      VALUES($1,'TPS-TEST-101','مقرر اختبار الجدولة',1,2,1,20,'ONSITE','["ONSITE"]'::jsonb,
        '[]'::jsonb,false)
      ON CONFLICT(department_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,[departmentId]);
    await client.query(`INSERT INTO curriculum_items(plan_id,course_id,level,is_required)
      VALUES($1,$2,1,true) ON CONFLICT(plan_id,course_id) DO NOTHING`,[
      plan.rows[0]!.id,course.rows[0]!.id
    ]);
    const cohort=await client.query<{id:string}>(`
      INSERT INTO cohorts(department_id,program_id,code,name,level)
      VALUES($1,$2,'TPS-G1','فوج تجريبي 1',1)
      ON CONFLICT(department_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,[
      departmentId,program.rows[0]!.id
    ]);
    const block=await client.query<{id:string}>(`
      INSERT INTO student_blocks(cohort_id,code,name,size)
      VALUES($1,'TPS-B1','بلوك تجريبي',20)
      ON CONFLICT(cohort_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,[cohort.rows[0]!.id]);
    await client.query(`INSERT INTO block_course_assignments(block_id,course_id,term_id)
      VALUES($1,$2,$3) ON CONFLICT(block_id,course_id,term_id) DO NOTHING`,[
      block.rows[0]!.id,course.rows[0]!.id,termId
    ]);
    await client.query(`INSERT INTO instructors(department_id,code,name,max_load,allowed_modes)
      VALUES($1,'TPS-I1','مدرب تجريبي 1',18,'["ONSITE"]'::jsonb)
      ON CONFLICT(department_id,code) DO NOTHING`,[departmentId]);
    for(const [roomCode,kind] of [['TPS-R1','CLASSROOM'],['TPS-L1','LAB']]){
      await client.query(`INSERT INTO rooms(college_id,code,name,type,capacity)
        VALUES($1,$2,$3,$4,30) ON CONFLICT(college_id,code) DO NOTHING`,[
        collegeId,roomCode,'قاعة تجريبية '+roomCode,kind
      ]);
    }
    await client.query('COMMIT');
    console.log('Synthetic TPS fixture exists: TPS-DEMO-2027 (no users or trainee personal records)');
  }catch(e){await client.query('ROLLBACK');throw e;}
  finally{client.release();await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
