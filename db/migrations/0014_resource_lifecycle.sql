-- Forward-only resource lifecycle: never delete historical curricular or approved scenario references.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS courses_active_scope_idx ON courses(department_id,code) WHERE is_active;
CREATE INDEX IF NOT EXISTS instructors_active_scope_idx ON instructors(department_id,code) WHERE is_active;
CREATE INDEX IF NOT EXISTS rooms_active_scope_idx ON rooms(college_id,code) WHERE is_active;
