-- ─────────────────────────────────────────────────────────────
-- Jarvis — tracker forms + per-tracker Slack delivery
--
--  * A tracker can carry multiple named fields ("Send 20 DMs from
--    systemsandprocesses IG", …) — one form submission per day.
--  * Each tracker can post its own Slack prompt: custom channel,
--    custom time (app timezone), and an @mention of the person who
--    fills it out.
-- ─────────────────────────────────────────────────────────────

-- [{ "key": "ig_sp_dms", "label": "DMs from systemsandprocesses IG", "target": 20 }, …]
alter table trackers add column if not exists fields jsonb not null default '[]'::jsonb;

-- { "channel": "#general", "channel_id": "C…", "prompt_time": "16:00",
--   "mention": "<@U…>", "mention_name": "Dwight", "last_prompt_date": "YYYY-MM-DD" }
alter table trackers add column if not exists slack jsonb not null default '{}'::jsonb;

-- per-field numbers for multi-field trackers: { "ig_sp_dms": 20, … }
alter table tracker_entries add column if not exists values jsonb not null default '{}'::jsonb;
