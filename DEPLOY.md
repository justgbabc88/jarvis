# Deploying Jarvis

Three pieces: **Supabase** (database), **Vercel** (web app), **Railway** (worker).

## 1. Supabase

1. Create a project at supabase.com.
2. In the SQL editor, paste and run `supabase/migrations/0001_init.sql`.
3. Grab from Project Settings → API:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, keep secret)

## 2. Vercel (web)

1. New Project → import the repo.
2. **Root Directory**: `jarvis/apps/web` (this is a self-contained app inside the repo).
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
   APP_TIMEZONE=America/New_York
   ```
5. Deploy. Visit the URL, log in with `APP_PASSWORD`.

> If the monorepo root directory isn't selectable, set Vercel's
> "Root Directory" to `jarvis/apps/web` and leave install command as `npm install`.

## 3. Railway (worker)

1. New Project → Deploy from the repo.
2. **Root Directory**: `jarvis/apps/worker`.
3. Start command: `npm install && npm start`.
4. Environment variables:
   ```
   APP_URL=https://<your-vercel-app>.vercel.app
   CRON_SECRET=<same value as Vercel>
   SYNC_CRON=0 * * * *      # hourly snapshot refresh (optional)
   PORT=8080
   ```
5. Deploy. Check the logs for `jarvis-worker listening` and `[sync] ok`.

The worker calls `POST {APP_URL}/api/snapshot/sync` on the schedule, authenticated
with `CRON_SECRET`, so revenue + ad spend stay fresh without you clicking anything.

## 4. Connect your data

In the app:
- **Settings** → add your businesses (e.g. Londen Leads, Lenne). Optionally set a
  Meta ad account id per business.
- **Connections** → add **NMI** (security key) and **Meta** (access token + ad
  account id). Use **Test** to confirm before saving, then **Sync now** on the dashboard.

## Rotating the encryption key

`CREDENTIALS_ENC_KEY` encrypts stored connection credentials. If you change it,
re-enter your connections (old ciphertext won't decrypt with a new key).
