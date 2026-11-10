-- Delivery ownership is distinct from the department that owns the curriculum.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS assignment_scope text NOT NULL DEFAULT 'DEPARTMENT'
 CHECK(assignment_scope IN ('DEPARTMENT','EXTERNAL'));
ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_section_capacity integer NOT NULL DEFAULT 40
 CHECK(external_section_capacity BETWEEN 1 AND 5000);
ALTER TABLE courses ADD COLUMN IF NOT EXISTS responsible_department text;
