-- TPS foundational academic model: additive, non-destructive migration.
CREATE TABLE IF NOT EXISTS training_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id),
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(department_id,code)
);
CREATE TABLE IF NOT EXISTS curriculum_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES training_programs(id),
  code text NOT NULL,
  version_label text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(program_id,code)
);
CREATE TABLE IF NOT EXISTS curriculum_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES curriculum_plans(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  level integer NOT NULL CHECK (level BETWEEN 1 AND 12),
  is_required boolean NOT NULL DEFAULT true,
  UNIQUE(plan_id,course_id)
);
CREATE TABLE IF NOT EXISTS cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id),
  program_id uuid REFERENCES training_programs(id),
  code text NOT NULL,
  name text NOT NULL,
  level integer NOT NULL CHECK (level BETWEEN 1 AND 12),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(department_id,code)
);
CREATE TABLE IF NOT EXISTS student_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES cohorts(id),
  code text NOT NULL,
  name text NOT NULL,
  size integer NOT NULL CHECK (size > 0 AND size <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cohort_id,code)
);
CREATE TABLE IF NOT EXISTS block_course_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES student_blocks(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  term_id uuid NOT NULL REFERENCES academic_terms(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(block_id,course_id,term_id)
);
CREATE INDEX IF NOT EXISTS bca_course_term_idx ON block_course_assignments(course_id,term_id);
CREATE TABLE IF NOT EXISTS demand_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id),
  term_id uuid NOT NULL REFERENCES academic_terms(id),
  base_students integer NOT NULL CHECK (base_students >= 0 AND base_students <= 5000),
  repeat_rate numeric(6,4) NOT NULL DEFAULT 0.0500 CHECK (repeat_rate >= 0 AND repeat_rate <= 0.5),
  projected_students integer NOT NULL CHECK (projected_students >= 0 AND projected_students <= 7500),
  source text NOT NULL CHECK(length(trim(source)) >= 3),
  confidence text NOT NULL DEFAULT 'MEDIUM' CHECK(confidence IN ('LOW','MEDIUM','HIGH')),
  notes text,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id,term_id)
);
