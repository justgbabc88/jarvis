import Fastify from "fastify";
import cron from "node-cron";

/**
 * Jarvis worker (Railway).
 *
 * Responsibilities:
 *  1. Keep the business snapshot fresh by asking the web app to sync
 *     revenue (NMI) + ad spend (Meta) on a schedule.
 *  2. Tick the agent scheduler once a minute — the web app decides which
 *     deployed agents are due (their cron, evaluated in the app timezone)
 *     and runs them.
 *
 * The web app owns all the connector + DB logic, so the worker stays thin
 * and calls back into it over HTTP with a shared CRON_SECRET.
 */

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET || "";
const PORT = Number(process.env.WORKER_PORT || process.env.PORT || 8080);
// How often to refresh the snapshot. Default: top of every hour.
const SYNC_CRON = process.env.SYNC_CRON || "0 * * * *";
// When to generate the morning briefing, in APP_TIMEZONE. Default: 7am daily.
const BRIEFING_CRON = process.env.BRIEFING_CRON || "0 7 * * *";
const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/New_York";

async function syncSnapshots(): Promise<void> {
  const url = `${APP_URL}/api/snapshot/sync`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[sync] failed (${res.status})`, body);
    } else {
      console.log(`[sync] ok — updated ${body.updated} businesses`);
    }
  } catch (err) {
    console.error("[sync] error reaching app:", err);
  }
}

async function tickAgents(): Promise<void> {
  const url = `${APP_URL}/api/agents/run-due`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[agents] tick failed (${res.status})`, body);
    } else if (body.due > 0) {
      console.log(`[agents] ran ${body.due} due agent(s):`, body.results);
    }
  } catch (err) {
    console.error("[agents] error reaching app:", err);
  }
}

async function generateBriefing(): Promise<void> {
  const url = `${APP_URL}/api/briefing`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[briefing] failed (${res.status})`, body);
    } else {
      console.log(`[briefing] ok — generated for ${body.briefing?.briefing_date}`);
    }
  } catch (err) {
    console.error("[briefing] error reaching app:", err);
  }
}

const app = Fastify({ logger: false });

app.get("/health", async () => ({ ok: true, service: "jarvis-worker", time: new Date().toISOString() }));

// Manual trigger (handy for testing): POST /run/sync with the cron secret.
app.post("/run/sync", async (req, reply) => {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  await syncSnapshots();
  return { ok: true };
});

async function main() {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`jarvis-worker listening on :${PORT}`);
  console.log(`[cron] snapshot sync scheduled: "${SYNC_CRON}" (app: ${APP_URL})`);

  cron.schedule(SYNC_CRON, () => {
    console.log("[cron] running snapshot sync…");
    void syncSnapshots();
  });

  // Agent scheduler tick: every minute, ask the app which agents are due.
  cron.schedule("* * * * *", () => {
    void tickAgents();
  });

  // Morning briefing, evaluated in the owner's timezone so "7am" means 7am.
  console.log(`[cron] briefing scheduled: "${BRIEFING_CRON}" (${APP_TIMEZONE})`);
  cron.schedule(
    BRIEFING_CRON,
    () => {
      console.log("[cron] generating morning briefing…");
      void generateBriefing();
    },
    { timezone: APP_TIMEZONE }
  );

  // Run one sync shortly after boot so data is fresh on deploy.
  setTimeout(() => void syncSnapshots(), 5000);
}

main().catch((err) => {
  console.error("worker failed to start:", err);
  process.exit(1);
});
