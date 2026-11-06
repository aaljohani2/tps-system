-- Extends V1 without touching historical 0001 checksums.
CREATE TABLE IF NOT EXISTS planning_policies (
 department_id uuid NOT NULL REFERENCES departments(id),
 term_id uuid NOT NULL REFERENCES academic_terms(id),
 draft_policy jsonb NOT NULL,
 approved_policy jsonb,
 draft_revision integer NOT NULL DEFAULT 1 CHECK (draft_revision > 0),
 approved_revision integer NOT NULL DEFAULT 0 CHECK (approved_revision >= 0),
 rationale text,
 updated_by uuid REFERENCES users(id),
 approved_by uuid REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz,
 PRIMARY KEY (department_id,term_id)
);
ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_solver_status_check;
ALTER TABLE scenarios ADD CONSTRAINT scenarios_solver_status_check
 CHECK (solver_status IN ('NOT_RUN','RUNNING','COMPLETED','FAILED'));
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS policy_revision integer NOT NULL DEFAULT 0;
