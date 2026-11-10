-- Preserve proposed course eligibility while preventing spreadsheet-based auto approval.
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_kind_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_kind_check
 CHECK(kind IN ('courses','instructors','rooms','blocks','demand'));
CREATE TABLE IF NOT EXISTS course_import_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 course_id uuid NOT NULL REFERENCES courses(id),
 import_job_id uuid NOT NULL REFERENCES import_jobs(id),
 requested_mode text NOT NULL CHECK(requested_mode IN ('ONSITE','REMOTE','SELF_PACED','HYBRID')),
 requested_eligible_modes jsonb NOT NULL,
 requires_approval boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(course_id,import_job_id)
);
CREATE INDEX IF NOT EXISTS course_import_proposals_course_idx ON course_import_proposals(course_id,created_at DESC);
