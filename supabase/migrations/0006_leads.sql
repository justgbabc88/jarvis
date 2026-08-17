-- ─────────────────────────────────────────────────────────────
-- Jarvis — leads
--
-- Where prospecting agents put what they find, so a nightly run
-- becomes a working list instead of a Slack message that scrolls
-- away. Deduped on business name + city so re-runs never pile up
-- the same contractor twice.
-- ─────────────────────────────────────────────────────────────

create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  business_name text not null,
  trade         text,                       -- roofing, HVAC, plumbing…
  city          text,
  pain          text,                       -- the evidenced gap
  channel       text,                       -- where to reach them
  contact       text,                       -- handle / URL / phone
  opener        text,                       -- the drafted first message
  source        text default 'agent',       -- 'agent' | 'chat' | 'manual'
  status        text not null default 'new',-- new | contacted | replied | booked | won | dead
  notes         text,
  business_id   uuid references businesses(id) on delete set null,
  agent_run_id  uuid references agent_runs(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Dedupe key: same business in the same city is the same lead.
create unique index if not exists leads_dedupe_idx
  on leads (lower(business_name), lower(coalesce(city, '')));

create index if not exists leads_status_idx on leads (status, created_at desc);

drop trigger if exists touch_leads on leads;
create trigger touch_leads before update on leads
  for each row execute function touch_updated_at();

alter table leads enable row level security;
drop policy if exists deny_all on leads;
create policy deny_all on leads for all
  to anon, authenticated using (false) with check (false);
