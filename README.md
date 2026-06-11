# Jarvis

A private **Jarvis** for your businesses: one screen that shows how everything is
doing, and (soon) AI agents you build in plain English that do the work for you.

Built on exactly the stack you asked for — **Vercel** (web), **Railway** (worker),
**Supabase** (data), **Claude** (the brain). Voice is **free** (your browser),
no Retell, no paid service.

> This lives as a self-contained project so it can be lifted into its own
> `jarvis` repo at any time (`git subtree split --prefix jarvis`).

## What's here today (Phases 0–4)

- **Snapshot dashboard** — revenue + ad spend per business, month-to-date and today,
  net and ROAS, plus "what Jarvis did yesterday."
- **Real connectors** — **NMI** for revenue, **Meta** for ad spend. Add your keys on
  the Connections screen (encrypted at rest) and hit **Sync now**.
- **Businesses are settings, not code** — add/remove any business from Settings.
  Nothing is hardcoded.
- **Voice** — ask out loud (or type) and Jarvis answers, read back by your browser.
- **Goals** — set a goal; Claude proposes revenue moves + research; approve one and
  Jarvis runs it immediately as a one-off agent job.
- **Agents** — describe a job in plain English, deploy it on a schedule (hourly,
  daily 9am, weekdays, or custom cron — evaluated in your timezone). Agents run a
  Claude tool-use loop with access to your real business numbers and **web search**,
  and a full step-by-step trace + report lands in run history and the activity feed.
- **Approval gate** — agents *cannot* send, post, delete, or spend directly. The only
  path is a `request_approval` tool that queues the fully-drafted action for your tap.

## What's next

- **Action connectors** — executing approved actions (email, ad budget changes, …)
  and letting agents use any MCP server you've connected.
- **Calendar + tasks** for the "today" panel.
- **Daily briefing** — an auto-generated, voiced morning summary.

## Project layout

```
jarvis/
├─ apps/
│  ├─ web/      Next.js 15 app (Vercel) — dashboard, goals, connections, APIs
│  └─ worker/   Fastify + node-cron (Railway) — scheduled snapshot sync, agents
└─ supabase/
   └─ migrations/  database schema
```

## Quick start (local)

1. **Create a Supabase project** and run the migration in
   `supabase/migrations/0001_init.sql` (SQL editor, or `supabase db push`).
2. **Env**: copy `.env.example` → `apps/web/.env.local` and fill in Supabase +
   `ANTHROPIC_API_KEY` + `APP_PASSWORD` + `APP_SECRET` + `CREDENTIALS_ENC_KEY`
   (`openssl rand -base64 32`).
3. Install + run:
   ```bash
   npm install
   npm run dev          # web on http://localhost:3000
   npm run worker:dev   # worker on http://localhost:8080 (optional locally)
   ```
4. Open the app, log in with `APP_PASSWORD`, add a business in **Settings**, add your
   **NMI** and **Meta** keys in **Connections**, then **Sync now**.

See [DEPLOY.md](./DEPLOY.md) for Vercel + Railway + Supabase deployment.

## Connectors

- **NMI (revenue)** — uses the Query API with your gateway **security key**. Settled
  sales minus refunds, rolled up by day.
- **Meta (ad spend)** — Marketing API insights for an **ad account** (`act_…`) with a
  long-lived **access token**, per-day spend.

Credentials are AES-256-GCM encrypted with `CREDENTIALS_ENC_KEY` before they touch the
database, and are only ever decrypted server-side.
