-- Preserve source lineage for scenario forks; older scenarios remain unaffected.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS parent_scenario_id uuid REFERENCES scenarios(id);
CREATE INDEX IF NOT EXISTS scenarios_parent_idx ON scenarios(parent_scenario_id);
