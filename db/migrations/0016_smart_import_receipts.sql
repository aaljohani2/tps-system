-- Immutable, idempotent receipt for a whole smart-import transaction.
-- No learner names, trainee numbers or uploaded file bytes are retained.
CREATE TABLE IF NOT EXISTS smart_import_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id),
  term_id uuid NOT NULL REFERENCES academic_terms(id),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  program_id uuid NOT NULL REFERENCES training_programs(id),
  plan_id uuid NOT NULL REFERENCES curriculum_plans(id),
  scenario_id uuid NOT NULL REFERENCES scenarios(id),
  plan_file_sha256 text NOT NULL CHECK (plan_file_sha256 ~ '^[a-f0-9]{64}$'),
  trainee_file_sha256 text NOT NULL CHECK (trainee_file_sha256 ~ '^[a-f0-9]{64}$'),
  resources_file_sha256 text,
  summary jsonb NOT NULL,
  imported_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(department_id,term_id,request_sha256)
);
CREATE INDEX IF NOT EXISTS smart_import_receipts_plan_idx ON smart_import_receipts(plan_id);
