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
