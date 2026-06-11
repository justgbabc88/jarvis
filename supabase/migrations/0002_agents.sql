-- ─────────────────────────────────────────────────────────────
-- Jarvis — agent scheduling support
-- ─────────────────────────────────────────────────────────────

-- Guard against double-running an agent within the same cron minute,
-- and let the UI show "last ran X ago".
alter table agents add column if not exists last_run_at timestamptz;

-- Ad-hoc runs (e.g. an approved goal suggestion) have no persistent agent.
-- agent_id is already nullable; give those runs a display label instead.
alter table agent_runs add column if not exists label text;

-- Link a suggestion to the run that executed it.
alter table suggestions
  drop constraint if exists suggestions_agent_run_id_fkey;
alter table suggestions
  add constraint suggestions_agent_run_id_fkey
  foreign key (agent_run_id) references agent_runs(id) on delete set null;
