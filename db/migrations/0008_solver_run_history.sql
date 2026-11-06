-- Timefold attempt history and explicit abandoned-run recovery.
CREATE TABLE IF NOT EXISTS solver_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scenario_id uuid NOT NULL REFERENCES scenarios(id),
 requested_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'RUNNING' CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 elapsed_ms integer CHECK(elapsed_ms IS NULL OR elapsed_ms>=0),
 result_metrics jsonb,
 score jsonb,
 error_message text
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_running_solver_per_scenario
 ON solver_runs(scenario_id) WHERE status='RUNNING';
CREATE INDEX IF NOT EXISTS solver_runs_history_idx ON solver_runs(scenario_id,started_at DESC);
