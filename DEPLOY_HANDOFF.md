# Deploy handoff — Vercel + Railway (delete me after deploy)

State as of 2026-06-12: code complete on branch `claude/vibrant-gates-de7zt4`,
Supabase project **Jarvis** (`essbvktshxevzzgnhmgq`, us-east-1) is live with all
3 migrations applied. Web (Vercel) and worker (Railway) are NOT deployed yet.

This doc lets a fresh Claude session finish the deploy without re-deriving
anything. No secrets live in this file.

## Prerequisites (the owner sets these in the Claude environment)

- Network allowlist: `api.vercel.com`, `backboard.railway.app`
- Env vars: `VERCEL_TOKEN`, `RAILWAY_TOKEN`, `ANTHROPIC_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`

## Where the generated app secrets are

`app_settings` table in the Jarvis Supabase project, key `deploy_bootstrap`
(read with the Supabase MCP `execute_sql`):
APP_PASSWORD, APP_SECRET, CREDENTIALS_ENC_KEY, CRON_SECRET, APP_TIMEZONE,
ANTHROPIC_MODEL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY.

**Delete that row after the env vars are set in Vercel + Railway.**

## Plan

1. **Vercel** (team `team_OyT6rvANs9ECzCtbs3nrDcAX`, REST API with VERCEL_TOKEN):
   - `POST /v11/projects?teamId=…` — name `jarvis`, framework `nextjs`,
     `rootDirectory: "apps/web"`, `gitRepository: { type: "github", repo: "justgbabc88/jarvis" }`
   - `POST /v10/projects/jarvis/env?teamId=…` — all vars from `deploy_bootstrap`
     + `ANTHROPIC_API_KEY` + `SUPABASE_SERVICE_ROLE_KEY` (targets: production, preview)
   - Trigger deployment: `POST /v13/deployments?teamId=…` with
     `gitSource: { type: "github", repo: "justgbabc88/jarvis", ref: "claude/vibrant-gates-de7zt4" }`
     (or set production branch to that ref / merge to main if the owner says so)
   - Verify with the Vercel MCP tools (build logs, runtime logs)
2. **Railway** (GraphQL `backboard.railway.app/graphql/v2` with RAILWAY_TOKEN,
   or `railway` CLI):
   - Create project `jarvis-worker`, service from GitHub repo `justgbabc88/jarvis`,
     root directory `apps/worker`, start command `npm install && npm start`
   - Vars: `APP_URL` (the Vercel prod URL), `CRON_SECRET` (same as Vercel),
     `SYNC_CRON=0 * * * *`, `BRIEFING_CRON=0 7 * * *`,
     `APP_TIMEZONE=America/Chicago`, `PORT=8080`
   - Verify logs show `jarvis-worker listening` and `[sync] ok`
3. Delete the `deploy_bootstrap` row, delete this file, report the login URL
   + APP_PASSWORD location to the owner, then walk the end-to-end test in
   DEPLOY.md §4–5.
