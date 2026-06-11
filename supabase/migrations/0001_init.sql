-- ─────────────────────────────────────────────────────────────
-- Jarvis — initial schema
--
-- Design notes:
--  * Personal, single-operator app. Server code uses the Supabase
--    service-role key; the browser never talks to these tables
--    directly, so RLS is enabled with a deny-by-default policy and
--    all access goes through the Next.js server / worker.
--  * NOTHING about a specific business is hardcoded. Businesses are
--    rows in `businesses`; add/remove them from Settings.
--  * Anything that sends / posts / deletes / spends is funneled
--    through `approvals` and must be approved before it runs.
-- ─────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── Businesses (config-driven, not code) ─────────────────────
create table if not exists businesses (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  is_active    boolean not null default true,
  -- which connections feed this business, plus display prefs:
  -- { "nmi": {...}, "meta": { "ad_account_id": "act_123" }, "color": "#7c5cff" }
  settings     jsonb not null default '{}'::jsonb,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Connections (NMI, Meta, calendars, task tools, MCP servers) ─
create table if not exists connections (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,            -- 'nmi' | 'meta' | 'google_calendar' | 'clickup' | 'mcp' | ...
  label        text not null,
  -- credentials are AES-encrypted at the app layer before insert.
  credentials  jsonb not null default '{}'::jsonb,
  config       jsonb not null default '{}'::jsonb,
  status       text not null default 'connected',  -- 'connected' | 'error' | 'disabled'
  last_checked timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Daily metric snapshots (revenue + ad spend per business) ──
create table if not exists metric_snapshots (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references businesses(id) on delete cascade,
  metric_date  date not null,
  revenue_cents   bigint not null default 0,
  ad_spend_cents  bigint not null default 0,
  source       text,                      -- 'nmi+meta', 'manual', ...
  raw          jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (business_id, metric_date)
);
create index if not exists metric_snapshots_business_date_idx
  on metric_snapshots (business_id, metric_date desc);

-- ── Goals + suggestions ──────────────────────────────────────
create table if not exists goals (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references businesses(id) on delete set null,
  title        text not null,
  description  text,
  target_date  date,
  status       text not null default 'active',  -- 'active' | 'achieved' | 'archived'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists suggestions (
  id           uuid primary key default gen_random_uuid(),
  goal_id      uuid references goals(id) on delete cascade,
  kind         text not null,             -- 'revenue' | 'research'
  title        text not null,
  rationale    text,
  -- a plain-English job spec the agent runner can pick up on approval
  job_spec     text,
  status       text not null default 'proposed', -- 'proposed' | 'approved' | 'rejected' | 'running' | 'done'
  agent_run_id uuid,
  created_at   timestamptz not null default now()
);

-- ── Agents + runs ────────────────────────────────────────────
create table if not exists agents (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,                     -- the job, in plain English
  system_prompt text,                     -- compiled instructions for Claude
  tools         jsonb not null default '[]'::jsonb,  -- connection ids / MCP servers it may use
  schedule_cron text,                     -- e.g. '0 13 * * *' ; null = manual only
  enabled       boolean not null default false,
  business_id   uuid references businesses(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists agent_runs (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid references agents(id) on delete cascade,
  trigger     text not null default 'manual',  -- 'manual' | 'schedule' | 'goal'
  status      text not null default 'running', -- 'running' | 'succeeded' | 'failed' | 'awaiting_approval'
  summary     text,
  steps       jsonb not null default '[]'::jsonb,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists agent_runs_agent_idx on agent_runs (agent_id, started_at desc);

-- ── Approvals (the safety gate) ──────────────────────────────
-- Any action that sends / posts / deletes / spends lands here first.
create table if not exists approvals (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,            -- 'send' | 'post' | 'delete' | 'spend' | 'other'
  title         text not null,
  detail        text,
  amount_cents  bigint,                   -- for 'spend'
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending', -- 'pending' | 'approved' | 'rejected' | 'expired'
  agent_id      uuid references agents(id) on delete set null,
  agent_run_id  uuid references agent_runs(id) on delete set null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index if not exists approvals_status_idx on approvals (status, created_at desc);

-- ── Activity log ("what Jarvis did yesterday") ───────────────
create table if not exists activity_log (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references businesses(id) on delete set null,
  agent_id     uuid references agents(id) on delete set null,
  agent_run_id uuid references agent_runs(id) on delete set null,
  type         text not null,            -- 'agent_run' | 'approval' | 'metric_sync' | 'goal' | ...
  summary      text not null,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists activity_log_created_idx on activity_log (created_at desc);

-- ── Key/value app settings (voice prefs, timezone, spend caps) ─
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── updated_at touch trigger ─────────────────────────────────
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['businesses','connections','goals','agents'] loop
    execute format(
      'drop trigger if exists touch_%1$s on %1$s;
       create trigger touch_%1$s before update on %1$s
       for each row execute function touch_updated_at();', t);
  end loop;
end $$;

-- ── RLS: deny direct client access; server uses service role ──
do $$
declare t text;
begin
  foreach t in array array[
    'businesses','connections','metric_snapshots','goals','suggestions',
    'agents','agent_runs','approvals','activity_log','app_settings'
  ] loop
    execute format('alter table %s enable row level security;', t);
    execute format('drop policy if exists deny_all on %s;', t);
    execute format(
      'create policy deny_all on %s for all
       to anon, authenticated using (false) with check (false);', t);
  end loop;
end $$;
