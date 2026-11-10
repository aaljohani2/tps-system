-- One active curriculum version per program, and acyclic course prerequisites.
CREATE TABLE IF NOT EXISTS course_prerequisites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 course_id uuid NOT NULL REFERENCES courses(id),
 prerequisite_course_id uuid NOT NULL REFERENCES courses(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT distinct_course_prerequisite CHECK(course_id<>prerequisite_course_id),
 UNIQUE(course_id,prerequisite_course_id)
);
CREATE INDEX IF NOT EXISTS course_prereq_reverse_idx ON course_prerequisites(prerequisite_course_id);
ALTER TABLE curriculum_plans ADD COLUMN IF NOT EXISTS activated_at timestamptz;
ALTER TABLE curriculum_plans ADD COLUMN IF NOT EXISTS activated_by uuid REFERENCES users(id);
ALTER TABLE curriculum_plans ADD COLUMN IF NOT EXISTS activation_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS only_one_active_plan_per_program
 ON curriculum_plans(program_id) WHERE state='ACTIVE';
