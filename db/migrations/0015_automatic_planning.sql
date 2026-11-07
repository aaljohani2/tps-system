-- Automatic planning imports are versioned and never replace an earlier plan silently.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_non_timetabled boolean NOT NULL DEFAULT false;
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  WHERE c.conrelid='courses'::regclass AND c.contype='c'
    AND pg_get_constraintdef(c.oid) LIKE '%theory_hours%practical_hours%> 0%'
  LIMIT 1;
  IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE courses DROP CONSTRAINT %I',constraint_name); END IF;
END $$;
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_contact_or_nontimetabled_check;
ALTER TABLE courses ADD CONSTRAINT courses_contact_or_nontimetabled_check
  CHECK(theory_hours+practical_hours>0 OR is_non_timetabled=true);

CREATE TABLE IF NOT EXISTS curriculum_plan_sources (
  plan_id uuid PRIMARY KEY REFERENCES curriculum_plans(id),
  source_sha256 text NOT NULL CHECK(length(source_sha256)=64),
  source_sheet text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL,
  imported_by uuid NOT NULL REFERENCES users(id),
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS curriculum_item_details (
  curriculum_item_id uuid PRIMARY KEY REFERENCES curriculum_items(id),
  source_code text NOT NULL,
  normalized_code text NOT NULL,
  theory_hours numeric(8,2) NOT NULL CHECK(theory_hours>=0),
  practical_hours numeric(8,2) NOT NULL CHECK(practical_hours>=0),
  tutorial_hours numeric(8,2) NOT NULL CHECK(tutorial_hours>=0),
  credits numeric(8,2),
  prerequisites jsonb NOT NULL DEFAULT '[]'::jsonb,
  equivalents jsonb NOT NULL DEFAULT '[]'::jsonb,
  responsible_department text,
  alternative_group text,
  special_kind text NOT NULL CHECK(special_kind IN ('REGULAR','COOPERATIVE_TRAINING','PRODUCTION_PROJECT')),
  source_row integer NOT NULL CHECK(source_row>1)
);
CREATE INDEX IF NOT EXISTS curriculum_item_details_match_idx ON curriculum_item_details(normalized_code);

CREATE TABLE IF NOT EXISTS level_demand_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES training_programs(id),
  term_id uuid NOT NULL REFERENCES academic_terms(id),
  level integer NOT NULL CHECK(level BETWEEN 1 AND 12),
  students integer NOT NULL CHECK(students BETWEEN 0 AND 7500),
  source_kind text NOT NULL CHECK(source_kind IN ('ACTUAL_LEVEL_COUNTS','COURSE_REGISTRATIONS','HISTORICAL_WORKBOOK','LEVEL_TRANSITION')),
  source_label text NOT NULL,
  confidence text NOT NULL CHECK(confidence IN ('LOW','MEDIUM','HIGH')),
  is_historical boolean NOT NULL,
  source_term_code text,
  recorded_at timestamptz,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(program_id,term_id,level,source_kind,source_label)
);
