-- Non-destructive resource qualification/equipment requirements.
-- Empty arrays preserve the existing, unrestricted legacy planning behavior.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS required_specialties jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS required_equipment jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS specialties jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS equipment_codes jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE courses ADD CONSTRAINT courses_specialties_array_check CHECK(jsonb_typeof(required_specialties)='array');
ALTER TABLE courses ADD CONSTRAINT courses_equipment_array_check CHECK(jsonb_typeof(required_equipment)='array');
ALTER TABLE instructors ADD CONSTRAINT instructors_specialties_array_check CHECK(jsonb_typeof(specialties)='array');
ALTER TABLE rooms ADD CONSTRAINT rooms_equipment_codes_array_check CHECK(jsonb_typeof(equipment_codes)='array');
