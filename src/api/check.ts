import {pool} from './database.js';
async function main(){
  const db=await pool.query<{ok:number}>('SELECT 1 AS ok');
  const migrations=await pool.query<{version:string}>('SELECT version FROM schema_migrations ORDER BY version');
  if(db.rows[0]?.ok!==1 || !['0001_foundation','0002_policy_and_solver_state','0003_scenario_lineage','0004_curriculum_demand_and_cohorts','0005_manual_schedule_changes','0006_approved_load_exceptions','0007_plan_lifecycle_prerequisites','0008_solver_run_history','0009_import_batches','0010_course_import_proposals','0011_solver_cancellation','0012_solver_progress','0013_specialties_and_equipment','0014_resource_lifecycle','0015_automatic_planning','0016_smart_import_receipts','0017_nullable_room_specs','0018_external_course_assignment'].every(version=>migrations.rows.some(x=>x.version===version))) throw new Error('Database or migration unavailable');
  if(!migrations.rows.some(x=>x.version==='0019_instructor_teaching_rules'))throw new Error('Instructor teaching-rules migration unavailable');
  console.log('PostgreSQL reachable; required migrations 0001–0019 present');
  await pool.end();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
