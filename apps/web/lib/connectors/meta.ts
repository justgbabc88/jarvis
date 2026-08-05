import { DateRange, SpendResult, toCents } from "./types";

/**
 * Meta (Facebook/Instagram) ad spend via the Marketing API Insights edge.
 *   GET https://graph.facebook.com/v21.0/{ad_account_id}/insights
 *
 * We request spend with time_increment=1 to get a per-day breakdown.
 * Auth: a long-lived access token + an ad account id (act_XXXX).
 */

const GRAPH_VERSION = "v21.0";

export type MetaCreds = { access_token: string; ad_account_id: string };

export function metaCredsFromEnv(): MetaCreds | null {
  const t = process.env.META_ACCESS_TOKEN;
  const a = process.env.META_AD_ACCOUNT_ID;
  if (!t || !a) return null;
  return { access_token: t, ad_account_id: a };
}

function normalizeAccount(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

export type MetaEntityInsights = {
  id: string;
  name: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  ctr: number;        // %
  frequency: number;
  leads: number;
  cplCents: number | null; // null when no leads
};

const LEAD_ACTION_TYPES = new Set([
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
]);

/**
 * Campaign- or adset-level performance for the range. This is what turns
 * "spend is up" into "THIS adset's CPL doubled — cut it" (the adset ids
 * returned here are exactly what meta.budget_update executes against).
 */
export async function fetchMetaCampaignInsights(
  creds: MetaCreds,
  range: DateRange,
  level: "campaign" | "adset" = "campaign"
): Promise<MetaEntityInsights[]> {
  const account = normalizeAccount(creds.ad_account_id);
  const idField = level === "campaign" ? "campaign_id" : "adset_id";
  const nameField = level === "campaign" ? "campaign_name" : "adset_name";
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${account}/insights`);
  url.searchParams.set("level", level);
  url.searchParams.set(
    "fields",
    `${idField},${nameField},spend,impressions,clicks,ctr,frequency,actions`
  );
  url.searchParams.set("time_range", JSON.stringify({ since: range.since, until: range.until }));
  url.searchParams.set("limit", "200");
  url.searchParams.set("access_token", creds.access_token);

  const out: MetaEntityInsights[] = [];
  let next: string | null = url.toString();
  let guard = 0;
  while (next && guard++ < 10) {
    const res: Response = await fetch(next);
    const json: any = await res.json();
    if (json.error) throw new Error(`Meta API error: ${json.error.message || "unknown"}`);
    for (const row of json.data || []) {
      const spendCents = toCents(row.spend || "0");
      const leads = (row.actions || [])
        .filter((a: any) => LEAD_ACTION_TYPES.has(a.action_type))
        .reduce((s: number, a: any) => s + Number(a.value || 0), 0);
      out.push({
        id: String(row[idField] || ""),
        name: String(row[nameField] || "(unnamed)"),
        spendCents,
        impressions: Number(row.impressions || 0),
        clicks: Number(row.clicks || 0),
        ctr: Number(row.ctr || 0),
        frequency: Number(row.frequency || 0),
        leads,
        cplCents: leads > 0 ? Math.round(spendCents / leads) : null,
      });
    }
    next = json.paging?.next || null;
  }
  out.sort((a, b) => b.spendCents - a.spendCents);
  return out;
}

/** Compact text rendering for prompts. */
export function insightsToText(rows: MetaEntityInsights[], level: string, range: DateRange): string {
  if (rows.length === 0) return `AD PERFORMANCE (${level}): no activity in range`;
  const lines = [`AD PERFORMANCE (Meta, per ${level}, ${range.since} → ${range.until}):`];
  for (const r of rows.slice(0, 25)) {
    lines.push(
      `- ${r.name} [id ${r.id}]: spend $${(r.spendCents / 100).toFixed(2)}, ${r.leads} leads, ` +
        `CPL ${r.cplCents != null ? "$" + (r.cplCents / 100).toFixed(2) : "n/a"}, ` +
        `CTR ${r.ctr.toFixed(2)}%, freq ${r.frequency.toFixed(1)}`
    );
  }
  if (rows.length > 25) lines.push(`(+${rows.length - 25} more, sorted by spend)`);
  return lines.join("\n");
}

export async function fetchMetaSpend(
  creds: MetaCreds,
  range: DateRange
): Promise<SpendResult> {
  const account = normalizeAccount(creds.ad_account_id);
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${account}/insights`);
  url.searchParams.set("fields", "spend");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since: range.since, until: range.until }));
  url.searchParams.set("limit", "500");
  url.searchParams.set("access_token", creds.access_token);

  const byDay: { date: string; cents: number }[] = [];
  let totalCents = 0;
  let next: string | null = url.toString();
  let guard = 0;

  while (next && guard++ < 20) {
    const res: Response = await fetch(next);
    const json: any = await res.json();
    if (json.error) {
      throw new Error(`Meta API error: ${json.error.message || "unknown"}`);
    }
    for (const row of json.data || []) {
      const cents = toCents(row.spend || "0");
      const date = row.date_start || range.since;
      byDay.push({ date, cents });
      totalCents += cents;
    }
    next = json.paging?.next || null;
  }

  byDay.sort((a, b) => a.date.localeCompare(b.date));
  return { totalCents, byDay };
}
