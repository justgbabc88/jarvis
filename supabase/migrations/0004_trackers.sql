-- ─────────────────────────────────────────────────────────────
-- Jarvis — trackers
--
-- Owner-defined daily metrics ("cold outreach sent", "sales calls
-- booked"). Jarvis prompts for them in Slack every day and totals
-- them on the dashboard. Agents can create them from plain English.
-- ─────────────────────────────────────────────────────────────

create table if not exists trackers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,               -- "Cold outreach"
  question    text,                        -- "How many cold outreach messages went out today?"
  unit        text not null default 'count',
  business_id uuid references businesses(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists tracker_entries (
  id         uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references trackers(id) on delete cascade,
  entry_date date not null,
  value      numeric not null default 0,
  note       text,
  created_at timestamptz not null default now(),
  unique (tracker_id, entry_date)
);
create index if not exists tracker_entries_tracker_idx
  on tracker_entries (tracker_id, entry_date desc);

do $$
declare t text;
begin
  foreach t in array array['trackers','tracker_entries'] loop
    execute format('alter table %s enable row level security;', t);
    execute format('drop policy if exists deny_all on %s;', t);
    execute format(
      'create policy deny_all on %s for all
       to anon, authenticated using (false) with check (false);', t);
  end loop;
end $$;
