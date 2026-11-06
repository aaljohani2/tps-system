-- Forward-only, truthful solver progress stages; never fabricate a percentage.
-- An asynchronous request is accepted only after its scenario claim/run insert commit.
ALTER TABLE solver_runs ADD COLUMN IF NOT EXISTS progress_stage text NOT NULL DEFAULT 'QUEUED';
ALTER TABLE solver_runs ADD COLUMN IF NOT EXISTS progress_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE solver_runs ADD COLUMN IF NOT EXISTS requested_settings jsonb;
ALTER TABLE solver_runs DROP CONSTRAINT IF EXISTS solver_runs_progress_stage_check;
ALTER TABLE solver_runs ADD CONSTRAINT solver_runs_progress_stage_check
 CHECK(progress_stage IN
 ('QUEUED','VALIDATING','PREPARING','SOLVING','VERIFYING','SAVING','COMPLETED','FAILED','CANCELLED'));
UPDATE solver_runs SET progress_stage=status,progress_at=COALESCE(finished_at,started_at)
 WHERE status IN ('COMPLETED','FAILED','CANCELLED')
 AND progress_stage='QUEUED';
