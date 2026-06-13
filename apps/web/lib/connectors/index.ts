import { supabaseAdmin } from "../supabase";
import { decryptJson } from "../crypto";
import { DateRange } from "./types";
import { fetchNmiRevenue, nmiCredsFromEnv, NmiCreds, NmiFilter } from "./nmi";
import { fetchMetaSpend, metaCredsFromEnv, MetaCreds } from "./meta";

export * from "./types";
export { fetchNmiRevenue } from "./nmi";
export { fetchMetaSpend } from "./meta";

type ConnectionRow = {
  id: string;
  provider: string;
  credentials: string | Record<string, unknown> | null;
  config: Record<string, unknown> | null;
};

function decodeCreds<T>(row: ConnectionRow | undefined): T | null {
  if (!row || !row.credentials) return null;
  try {
    if (typeof row.credentials === "string") return decryptJson<T>(row.credentials);
    // already-decoded object (e.g. seeded for dev)
    return row.credentials as unknown as T;
  } catch {
    return null;
  }
}

/**
 * Resolve which NMI + Meta credentials a business should use.
 * Priority: a connection explicitly referenced in business.settings,
 * then the first connection of that provider, then env fallbacks.
 */
async function resolveCreds(businessId: string): Promise<{
  nmi: NmiCreds | null;
  nmiFilter: NmiFilter | null;
  meta: MetaCreds | null;
}> {
  const db = supabaseAdmin();
  const [{ data: business }, { data: connections }] = await Promise.all([
    db.from("businesses").select("id, settings").eq("id", businessId).single(),
    db.from("connections").select("id, provider, credentials, config").eq("status", "connected"),
  ]);

  const settings = (business?.settings as any) || {};
  const conns = (connections as ConnectionRow[]) || [];

  // "none" detaches the provider; an explicit id wins; otherwise only
  // auto-attach when there's exactly one connection of that provider —
  // sharing one gateway across businesses double-counts its numbers.
  const pick = (provider: string, preferredId?: string) => {
    if (preferredId === "none") return undefined;
    if (preferredId) return conns.find((c) => c.id === preferredId && c.provider === provider);
    const ofProvider = conns.filter((c) => c.provider === provider);
    return ofProvider.length === 1 ? ofProvider[0] : undefined;
  };

  const nmiRow = pick("nmi", settings?.nmi?.connection_id);
  const metaRow = pick("meta", settings?.meta?.connection_id);

  let nmi = decodeCreds<NmiCreds>(nmiRow) || nmiCredsFromEnv();
  let meta = decodeCreds<MetaCreds>(metaRow) || metaCredsFromEnv();

  // A business may override the Meta ad account in its own settings.
  if (meta && settings?.meta?.ad_account_id) {
    meta = { ...meta, ad_account_id: String(settings.meta.ad_account_id) };
  }

  // Optional payer filter so one NMI gateway can feed multiple businesses.
  const f = settings?.nmi?.filter;
  const nmiFilter: NmiFilter | null =
    f && (f.mode === "include" || f.mode === "exclude")
      ? { mode: f.mode, match: String(f.match || "") }
      : null;

  return { nmi, nmiFilter, meta };
}

export type BusinessMetrics = {
  businessId: string;
  range: DateRange;
  revenueCents: number;
  adSpendCents: number;
  revenueByDay: { date: string; cents: number }[];
  spendByDay: { date: string; cents: number }[];
  errors: string[];
  connected: { nmi: boolean; meta: boolean };
};

/** Live fetch (no DB write) of revenue + spend for a business over a range. */
export async function getBusinessMetrics(
  businessId: string,
  range: DateRange
): Promise<BusinessMetrics> {
  const { nmi, nmiFilter, meta } = await resolveCreds(businessId);
  const errors: string[] = [];
  let revenueCents = 0;
  let adSpendCents = 0;
  let revenueByDay: { date: string; cents: number }[] = [];
  let spendByDay: { date: string; cents: number }[] = [];

  if (nmi) {
    try {
      const r = await fetchNmiRevenue(nmi, range, nmiFilter);
      revenueCents = r.totalCents;
      revenueByDay = r.byDay;
    } catch (e: any) {
      errors.push(`NMI: ${e.message}`);
    }
  }
  if (meta) {
    // A business can aggregate several ad accounts (comma/space separated).
    const accounts = meta.ad_account_id.split(/[,\s]+/).filter(Boolean);
    const byDate = new Map<string, number>();
    for (const account of accounts) {
      try {
        const s = await fetchMetaSpend({ ...meta, ad_account_id: account }, range);
        adSpendCents += s.totalCents;
        for (const d of s.byDay) byDate.set(d.date, (byDate.get(d.date) || 0) + d.cents);
      } catch (e: any) {
        errors.push(`Meta (${account}): ${e.message}`);
      }
    }
    spendByDay = [...byDate.entries()]
      .map(([date, cents]) => ({ date, cents }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  return {
    businessId,
    range,
    revenueCents,
    adSpendCents,
    revenueByDay,
    spendByDay,
    errors,
    connected: { nmi: Boolean(nmi), meta: Boolean(meta) },
  };
}
