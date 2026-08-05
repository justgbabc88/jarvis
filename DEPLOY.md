# Deploying Jarvis

Three pieces: **Supabase** (database), **Vercel** (web app), **Railway** (worker).

## 1. Supabase

1. Create a project at supabase.com.
2. In the SQL editor, paste and run each file in `supabase/migrations/` **in order**:
   `0001_init.sql`, `0002_agents.sql`, `0003_actions_briefings.sql`, `0004_trackers.sql`
   (or `supabase db push`).
3. Grab from Project Settings → API:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, keep secret)

## 2. Vercel (web)

1. New Project → import the repo.
2. **Root Directory**: `apps/web`.
3. Framework preset: **Next.js**. Build command and output are auto-detected.
4. Environment variables (Production + Preview):
   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   ANTHROPIC_API_KEY
   ANTHROPIC_MODEL=claude-opus-4-8
   APP_PASSWORD          # your login password
   APP_SECRET            # random string, signs the session cookie
   CREDENTIALS_ENC_KEY   # openssl rand -base64 32
   CRON_SECRET           # random string, shared with the worker
   APP_TIMEZONE=America/Chicago
   ```
5. Deploy. Visit the URL, log in with `APP_PASSWORD`.

> If the monorepo root directory isn't selectable, set Vercel's
> "Root Directory" to `apps/web` and leave install command as `npm install`.

> ⚠️ **Enter Vercel env values by hand in the dashboard.** Writing them
> through Vercel's API from a Claude cloud session silently corrupts them:
> the sandbox's security proxy seals every value in transit (anti-exfiltration)
> and Vercel stores the sealed blobs. Railway's API is not affected.

## 3. Railway (worker)

1. New Project → Deploy from the repo.
2. **Root Directory**: `apps/worker`.
3. Start command: `npm install && npm start`.
4. Environment variables:
   ```
   APP_URL=https://<your-vercel-app>.vercel.app
   CRON_SECRET=<same value as Vercel>
   SYNC_CRON=0 * * * *          # hourly snapshot refresh (optional)
   BRIEFING_CRON=0 7 * * *      # morning briefing time (optional)
   APP_TIMEZONE=America/Chicago
   PORT=8080
   ```
5. Deploy. Check the logs for `jarvis-worker listening` and `[sync] ok`.

The worker calls back into the web app with `CRON_SECRET` on a schedule:
- `POST /api/snapshot/sync` — keeps revenue + ad spend fresh
- `POST /api/agents/run-due` — runs deployed agents whose cron is due (every minute)
- `POST /api/briefing` — generates the voiced morning briefing (at `BRIEFING_CRON`,
  evaluated in `APP_TIMEZONE`)

## 4. Connect your data

In the app:
- **Settings** → add your businesses (e.g. Londen Leads, Quantum Sync). Optionally set a
  Meta ad account id per business.
- **Connections** →
  - **NMI** (security key) — revenue
  - **Meta** (access token + ad account id) — ad spend, per-campaign/adset
    performance (CPL, CTR, frequency), and approved budget changes
  - **GoHighLevel** (private integration token + location id) — the funnel:
    opportunities per pipeline stage, values, wins. Sub-account → Settings →
    Private Integrations (needs opportunities scopes)
  - **Email (SMTP)** — lets approved emails actually send (Gmail: `smtp.gmail.com`,
    port 587, your address + an [app password](https://myaccount.google.com/apppasswords))
  - **Slack** (incoming webhook URL; optional bot token + signing secret) —
    see the **Slack** section below for full two-way setup.
  - **Google Calendar** — Settings → your calendar → "Secret address in iCal
    format" → paste the URL
  - **ClickUp** — Settings → Apps → API token (optionally pick one list)

  Use **Test** to confirm each before saving, then **Sync now** on the dashboard.

## Slack

One Slack app powers everything. Create it at api.slack.com/apps →
**Create New App → From a manifest** → pick your workspace → paste (swap in
your Vercel domain):

```yaml
display_information:
  name: Jarvis
features:
  bot_user:
    display_name: jarvis
    always_online: true
oauth_config:
  scopes:
    bot:
      - chat:write
      - im:history
      - app_mentions:read
      - incoming-webhook
      - channels:read   # find "#general" by name for tracker prompts
      - users:read      # find "Dwight" by name for @mentions
settings:
  event_subscriptions:
    request_url: https://YOUR-APP.vercel.app/api/slack/events
    bot_events:
      - message.im
      - app_mention
  interactivity:
    is_enabled: true
    request_url: https://YOUR-APP.vercel.app/api/slack/interactive
  org_deploy_enabled: false
  socket_mode_enabled: false
```

Then, in this order (the app must be deployed first — Slack pings the
event URL to verify it):

1. **Install to Workspace** (OAuth & Permissions) — pick the channel for the
   incoming webhook. Copy the **webhook URL** and the **bot token** (`xoxb-…`).
2. **Basic Information** → copy the **signing secret**.
3. In Jarvis → **Connections → Slack**: paste all three, hit **Test**, save.
4. Back in Slack app settings → **Event Subscriptions** → hit **Retry** on the
   request URL so it verifies (it needs step 3's signing secret saved first).

What you get:
- **Notifications** (webhook): morning briefing, tracker prompts, agent-run
  reports, execution results.
- **Approval cards** (webhook + signing secret): every queued action posts
  with **Approve & run / Reject** buttons — deciding in Slack is identical
  to deciding in the app, including immediate execution.
- **Conversations** (bot token + signing secret): DM the Jarvis bot (or
  @mention it in a channel it's in) and it answers with live revenue/spend,
  history, calendar, and task context — the same brain as browser voice.

## Daily trackers

Say "create a cold outreach tracker" to Jarvis in Slack (or add one on the
dashboard). Every morning the Slack briefing asks for any unlogged tracker
numbers with a link to the one-tap log form; totals (today / 7-day / all-time)
live on the dashboard.

Trackers can also be **multi-field forms with their own Slack schedule** —
tell Jarvis e.g. *"create a tracker with these 5 metrics that posts a form in
#general at 4pm tagging Dwight"*. Requirements for that:
- the app has the `channels:read` + `users:read` scopes (reinstall after adding)
- the bot is invited to the target channel (`/invite @jarvis`)
- the tagged person fills the linked `/track/<id>` form; totals roll up on the
  dashboard

Optional: set `APP_PUBLIC_URL=https://your-app.vercel.app` on Vercel so Slack
messages link straight to the app (auto-detected on Vercel otherwise).

## 5. Approved actions actually run

When an agent queues an action and you tap **Approve & run**, Jarvis executes it
immediately and records the result on the approval + activity feed:
- `email.send` — sends through your SMTP connection
- `meta.budget_update` — changes an ad set / campaign daily budget via the Meta API

Anything else is marked "skipped" with the agent's full draft saved for you.

## Rotating the encryption key

`CREDENTIALS_ENC_KEY` encrypts stored connection credentials. If you change it,
re-enter your connections (old ciphertext won't decrypt with a new key).
