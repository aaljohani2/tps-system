-- Forward-only extension: a cancelled Timefold attempt is distinguishable from an execution failure.
-- Keep scenarios.solver_status=FAILED after cancellation so a DRAFT can be solved again.
ALTER TABLE solver_runs DROP CONSTRAINT IF EXISTS solver_runs_status_check;
ALTER TABLE solver_runs ADD CONSTRAINT solver_runs_status_check
 CHECK(status IN ('RUNNING','COMPLETED','FAILED','CANCELLED'));
