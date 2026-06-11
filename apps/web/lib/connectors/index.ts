import { supabaseAdmin } from "../supabase";
import { decryptJson } from "../crypto";
import { DateRange } from "./types";
import { fetchNmiRevenue, nmiCredsFromEnv, NmiCreds } from "./nmi";
import { fetchMetaSpend, metaCredsFromEnv, MetaCreds } from "./meta";

export * from "./types";
export { fetchNmiRevenue } from "./nmi";
export { fetchMetaSpend } from "./meta";
export { fetchTodayEvents } from "./calendar";
export { fetchDueTasks } from "./clickup";
export { sendEmail, verifyEmail } from "./email";

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
 * First connected connection of a provider, decrypted. Used by the
 * agenda (calendar/clickup) and the action executor (email/meta).
 */
export async function getProviderCreds<T>(provider: string): Promise<T | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("connections")
    .select("id, provider, credentials, config")
    .eq("provider", provider)
    .eq("status", "connected")
    .order("created_at")
    .limit(1);
  return decodeCreds<T>((data as ConnectionRow[])?.[0]);
}

/**
 * Resolve which NMI + Meta credentials a business should use.
 * Priority: a connection explicitly referenced in business.settings,
 * then the first connection of that provider, then env fallbacks.
 */
async function resolveCreds(businessId: string): Promise<{
  nmi: NmiCreds | null;
  meta: MetaCreds | null;
}> {
  const db = supabaseAdmin();
  const [{ data: business }, { data: connections }] = await Promise.all([
    db.from("businesses").select("id, settings").eq("id", businessId).single(),
    db.from("connections").select("id, provider, credentials, config").eq("status", "connected"),
  ]);

  const settings = (business?.settings as any) || {};
  const conns = (connections as ConnectionRow[]) || [];

  const pick = (provider: string, preferredId?: string) =>
    conns.find((c) => c.id === preferredId) || conns.find((c) => c.provider === provider);

  const nmiRow = pick("nmi", settings?.nmi?.connection_id);
  const metaRow = pick("meta", settings?.meta?.connection_id);

  let nmi = decodeCreds<NmiCreds>(nmiRow) || nmiCredsFromEnv();
  let meta = decodeCreds<MetaCreds>(metaRow) || metaCredsFromEnv();

  // A business may override the Meta ad account in its own settings.
  if (meta && settings?.meta?.ad_account_id) {
    meta = { ...meta, ad_account_id: String(settings.meta.ad_account_id) };
  }
  return { nmi, meta };
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
  const { nmi, meta } = await resolveCreds(businessId);
  const errors: string[] = [];
  let revenueCents = 0;
  let adSpendCents = 0;
  let revenueByDay: { date: string; cents: number }[] = [];
  let spendByDay: { date: string; cents: number }[] = [];

  if (nmi) {
    try {
      const r = await fetchNmiRevenue(nmi, range);
      revenueCents = r.totalCents;
      revenueByDay = r.byDay;
    } catch (e: any) {
      errors.push(`NMI: ${e.message}`);
    }
  }
  if (meta) {
    try {
      const s = await fetchMetaSpend(meta, range);
      adSpendCents = s.totalCents;
      spendByDay = s.byDay;
    } catch (e: any) {
      errors.push(`Meta: ${e.message}`);
    }
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
