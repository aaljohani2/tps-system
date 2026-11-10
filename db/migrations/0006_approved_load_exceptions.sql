-- Distinguish administrator-entered drafts from approved term-specific trainer load overrides.
CREATE TABLE IF NOT EXISTS instructor_load_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES instructors(id),
  term_id uuid NOT NULL REFERENCES academic_terms(id),
  additional_hours numeric(8,3) NOT NULL CHECK(additional_hours>0 AND additional_hours<=30),
  reason text NOT NULL CHECK(length(trim(reason))>=8),
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REJECTED','SUPERSEDED')),
  created_by uuid NOT NULL REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decision_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS approved_instructor_term_exception_idx
 ON instructor_load_exceptions(instructor_id,term_id) WHERE state='APPROVED';
CREATE INDEX IF NOT EXISTS instructor_load_scope_idx
 ON instructor_load_exceptions(instructor_id,term_id,created_at DESC);
