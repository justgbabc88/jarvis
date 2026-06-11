# Deploying Jarvis

Three pieces: **Supabase** (database), **Vercel** (web app), **Railway** (worker).

## 1. Supabase

1. Create a project at supabase.com.
2. In the SQL editor, paste and run each file in `supabase/migrations/` **in order**:
   `0001_init.sql`, `0002_agents.sql`, `0003_actions_briefings.sql`
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
- **Settings** → add your businesses (e.g. Londen Leads, Lenne). Optionally set a
  Meta ad account id per business.
- **Connections** →
  - **NMI** (security key) — revenue
  - **Meta** (access token + ad account id) — ad spend, and approved budget changes
  - **Email (SMTP)** — lets approved emails actually send (Gmail: `smtp.gmail.com`,
    port 587, your address + an [app password](https://myaccount.google.com/apppasswords))
  - **Calendar (ICS)** — Google Calendar → Settings → your calendar → "Secret address
    in iCal format" → paste the URL
  - **ClickUp** — Settings → Apps → API token

  Use **Test** to confirm each before saving, then **Sync now** on the dashboard.

## 5. Approved actions actually run

When an agent queues an action and you tap **Approve & run**, Jarvis executes it
immediately and records the result on the approval + activity feed:
- `email.send` — sends through your SMTP connection
- `meta.budget_update` — changes an ad set / campaign daily budget via the Meta API

Anything else is marked "skipped" with the agent's full draft saved for you.

## Rotating the encryption key

`CREDENTIALS_ENC_KEY` encrypts stored connection credentials. If you change it,
re-enter your connections (old ciphertext won't decrypt with a new key).
