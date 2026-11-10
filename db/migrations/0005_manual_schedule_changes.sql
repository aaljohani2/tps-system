-- Local scenario edits: optimistic concurrency and immutable before/after audit trail.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS edit_version integer NOT NULL DEFAULT 0 CHECK(edit_version>=0);
CREATE TABLE IF NOT EXISTS scenario_session_edits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scenario_id uuid NOT NULL REFERENCES scenarios(id),
  edit_version integer NOT NULL CHECK(edit_version>0),
  session_id text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  reason text NOT NULL CHECK(length(trim(reason))>=8),
  edited_by uuid NOT NULL REFERENCES users(id),
  edited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scenario_id,edit_version)
);
CREATE INDEX IF NOT EXISTS scenario_session_edits_lookup ON scenario_session_edits(scenario_id,edited_at DESC);
