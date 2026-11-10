-- Bounded, explicitly approved import previews; no uploaded payload is persisted.
CREATE TABLE IF NOT EXISTS import_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('instructors','rooms','blocks','demand')),
 department_id uuid NOT NULL REFERENCES departments(id),
 college_id uuid NOT NULL REFERENCES colleges(id),
 term_id uuid REFERENCES academic_terms(id),
 created_by uuid NOT NULL REFERENCES users(id),
 file_sha256 text NOT NULL CHECK (length(file_sha256)=64),
 row_count integer NOT NULL CHECK (row_count>=1 AND row_count<=500),
 status text NOT NULL DEFAULT 'PREVIEWED' CHECK (status IN ('PREVIEWED','COMMITTED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 minutes'),
 committed_at timestamptz,
 UNIQUE(id,created_by)
);
CREATE INDEX IF NOT EXISTS import_jobs_scope_idx ON import_jobs(department_id,created_by,created_at DESC);
