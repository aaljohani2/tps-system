/**
 * Populate the disposable CI-only PostgreSQL database with an APPROVED scenario,
 * a completed solver run and an audit event before taking an encrypted backup.
 * This is not the production seed script and MUST NEVER run on a user database.
 */
import pg from 'pg';
const db=process.env.TPS_DB_NAME;
if(process.env.TPS_ALLOW_SYNTHETIC_SEED!=='1'||db!=='tps_backup_ci')
  throw new Error('CI backup fixture requires explicitly opted-in tps_backup_ci database only');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try{
  await client.query('BEGIN');
  const resources=await client.query(`
    SELECT d.id AS department_id, t.id AS term_id
    FROM departments d JOIN academic_terms t ON t.college_id=d.college_id
    WHERE t.code='TPS-DEMO-2027' LIMIT 1`);
  const row=resources.rows[0];
  if(!row)throw new Error('Synthetic academic seed is missing');
  const operator=await client.query(`
    INSERT INTO users(username,password_hash,role,active)
    VALUES('tps_ci_backup_disabled','NOT_A_PASSWORD_HASH','SYSTEM_ADMIN',false)
    RETURNING id`);
  const userId=operator.rows[0].id;
  const scenario=await client.query(`
    INSERT INTO scenarios(department_id,term_id,name,state,solver_status,
      input_snapshot,result_snapshot,approved_snapshot,created_by,approved_by,approved_at)
    VALUES($1,$2,'CI ONLY — encrypted backup drill','APPROVED','COMPLETED',
      $3::jsonb,$4::jsonb,$4::jsonb,$5,$5,now()) RETURNING id`,[
      row.department_id,row.term_id,
      JSON.stringify({scenarioName:'CI synthetic backup check',courses:[],instructors:[],rooms:[]}),
      JSON.stringify({status:'APPROVED',sections:[],sessions:[],gaps:[],
        metrics:{sectionCount:0,requiredContactHours:0}}),userId]);
  const scenarioId=scenario.rows[0].id;
  await client.query(`
    INSERT INTO solver_runs(scenario_id,requested_by,status,finished_at,elapsed_ms,
      result_metrics,progress_stage)
    VALUES($1,$2,'COMPLETED',now(),10,$3::jsonb,'COMPLETED')`,[
      scenarioId,userId,JSON.stringify({sectionCount:0,synthetic:true})]);
  await client.query(`
    INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details)
    VALUES($1,'CI_BACKUP_DRILL','SCENARIO',$2,$3::jsonb)`,[
      userId,scenarioId,JSON.stringify({synthetic:true})]);
  await client.query('COMMIT');
  console.log('CI synthetic approved scenario, solver result and audit trace saved');
}catch(error){
  await client.query('ROLLBACK');
  throw error;
}finally{
  await client.end();
}
