ALTER TABLE instructors ADD COLUMN IF NOT EXISTS teaching_rules jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(teaching_rules) = 'object');
