-- Preserve incomplete source data without inventing capacity or facility type.
-- Existing rows and positive-capacity/type CHECK constraints remain intact.
ALTER TABLE rooms ALTER COLUMN capacity DROP NOT NULL;
ALTER TABLE rooms ALTER COLUMN type DROP NOT NULL;
