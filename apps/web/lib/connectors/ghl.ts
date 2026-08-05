import { DateRange } from "./types";

/**
 * GoHighLevel (LeadConnector) — the funnel between ad click and revenue:
 * opportunities per pipeline stage, values, and wins.
 *
 * Auth: a Private Integration token (Settings → Private Integrations in
 * the sub-account; needs opportunities scopes) + the location id.
 */

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

export type GhlCreds = { api_token: string; location_id: string };

async function ghl(creds: GhlCreds, path: string): Promise<any> {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    headers: {
      Authorization: `Bearer ${creds.api_token}`,
      Version: VERSION,
      Accept: "application/json",
    },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GHL API error (${res.status}): ${json.message || json.msg || "check the token/location"}`);
  }
  return json;
}

export type GhlPipeline = { id: string; name: string; stages: Map<string, string> };

export async function fetchGhlPipelines(creds: GhlCreds): Promise<GhlPipeline[]> {
  if (!creds?.api_token || !creds?.location_id) {
    throw new Error("a private integration token and location id are required");
  }
  const j = await ghl(creds, `/opportunities/pipelines?locationId=${encodeURIComponent(creds.location_id)}`);
  return (j.pipelines || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    stages: new Map((p.stages || []).map((s: any) => [s.id, s.name])),
  }));
}

export type GhlFunnel = {
  pipelines: {
    name: string;
    open: { stage: string; count: number; valueCents: number }[];
    createdInRange: number;
    wonInRange: { count: number; valueCents: number };
    lostInRange: number;
  }[];
  totalOpenValueCents: number;
};

/** Opportunity funnel: open snapshot per stage + created/won/lost in range. */
export async function fetchGhlFunnel(creds: GhlCreds, range: DateRange): Promise<GhlFunnel> {
  const pipelines = await fetchGhlPipelines(creds);
  const byPipeline = new Map(pipelines.map((p) => [p.id, p]));

  const since = new Date(`${range.since}T00:00:00Z`).getTime();
  const until = new Date(`${range.until}T23:59:59Z`).getTime();

  type Agg = {
    open: Map<string, { count: number; valueCents: number }>;
    createdInRange: number;
    won: { count: number; valueCents: number };
    lost: number;
  };
  const agg = new Map<string, Agg>();
  const getAgg = (pid: string): Agg => {
    if (!agg.has(pid)) agg.set(pid, { open: new Map(), createdInRange: 0, won: { count: 0, valueCents: 0 }, lost: 0 });
    return agg.get(pid)!;
  };

  let url = `/opportunities/search?location_id=${encodeURIComponent(creds.location_id)}&limit=100`;
  let guard = 0;
  while (url && guard++ < 15) {
    const j = await ghl(creds, url);
    for (const o of j.opportunities || []) {
      const a = getAgg(o.pipelineId);
      const valueCents = Math.round(Number(o.monetaryValue || 0) * 100);
      const created = Date.parse(o.createdAt || "") || 0;
      const updated = Date.parse(o.updatedAt || "") || created;
      const status = String(o.status || "open").toLowerCase();

      if (status === "open") {
        const stageName =
          byPipeline.get(o.pipelineId)?.stages.get(o.pipelineStageId) || "unknown stage";
        const s = a.open.get(stageName) || { count: 0, valueCents: 0 };
        s.count += 1;
        s.valueCents += valueCents;
        a.open.set(stageName, s);
      }
      if (created >= since && created <= until) a.createdInRange += 1;
      if (status === "won" && updated >= since && updated <= until) {
        a.won.count += 1;
        a.won.valueCents += valueCents;
      }
      if ((status === "lost" || status === "abandoned") && updated >= since && updated <= until) a.lost += 1;
    }
    url = j.meta?.nextPageUrl || "";
  }

  let totalOpenValueCents = 0;
  const out: GhlFunnel = {
    pipelines: pipelines
      .map((p) => {
        const a = getAgg(p.id);
        const open = [...a.open.entries()].map(([stage, v]) => ({ stage, ...v }));
        totalOpenValueCents += open.reduce((s, o) => s + o.valueCents, 0);
        return {
          name: p.name,
          open,
          createdInRange: a.createdInRange,
          wonInRange: a.won,
          lostInRange: a.lost,
        };
      })
      .filter((p) => p.open.length > 0 || p.createdInRange > 0 || p.wonInRange.count > 0),
    totalOpenValueCents,
  };
  return out;
}

/** Compact text rendering for prompts. */
export function funnelToText(f: GhlFunnel, range: DateRange): string {
  if (f.pipelines.length === 0) return "FUNNEL (GHL): no opportunities found";
  const lines: string[] = [`FUNNEL (GHL, ${range.since} → ${range.until}):`];
  for (const p of f.pipelines) {
    lines.push(
      `- ${p.name}: ${p.createdInRange} new opps in range · won ${p.wonInRange.count} ($${(p.wonInRange.valueCents / 100).toFixed(0)}) · lost ${p.lostInRange}`
    );
    for (const s of p.open) {
      lines.push(`    open @ ${s.stage}: ${s.count} ($${(s.valueCents / 100).toFixed(0)})`);
    }
  }
  lines.push(`Total open pipeline value: $${(f.totalOpenValueCents / 100).toFixed(0)}`);
  return lines.join("\n");
}
