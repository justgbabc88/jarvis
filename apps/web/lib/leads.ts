import { supabaseAdmin } from "./supabase";

/**
 * Leads — the working list prospecting agents fill each night.
 * Deduped on business name + city, so a re-run adds only what's new.
 */

export type Lead = {
  id: string;
  business_name: string;
  trade: string | null;
  city: string | null;
  pain: string | null;
  channel: string | null;
  contact: string | null;
  opener: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

export type LeadInput = {
  business_name: string;
  trade?: string;
  city?: string;
  pain?: string;
  channel?: string;
  contact?: string;
  opener?: string;
};

export const LEAD_STATUSES = ["new", "contacted", "replied", "booked", "won", "dead"] as const;

/** Insert leads, skipping ones already on the list. Returns what was new. */
export async function saveLeads(
  leads: LeadInput[],
  opts: { source?: string; businessId?: string | null; agentRunId?: string | null } = {}
): Promise<{ saved: number; skipped: number; names: string[] }> {
  const db = supabaseAdmin();
  const clean = leads
    .filter((l) => l && String(l.business_name || "").trim())
    .map((l) => ({
      business_name: String(l.business_name).trim().slice(0, 200),
      trade: l.trade ? String(l.trade).slice(0, 80) : null,
      city: l.city ? String(l.city).slice(0, 120) : null,
      pain: l.pain ? String(l.pain).slice(0, 1000) : null,
      channel: l.channel ? String(l.channel).slice(0, 120) : null,
      contact: l.contact ? String(l.contact).slice(0, 300) : null,
      opener: l.opener ? String(l.opener).slice(0, 1500) : null,
      source: opts.source || "agent",
      business_id: opts.businessId || null,
      agent_run_id: opts.agentRunId || null,
    }));
  if (clean.length === 0) return { saved: 0, skipped: 0, names: [] };

  // Dedupe on the generated `dedupe_key` column (lower(name)|lower(city)) —
  // it carries a real unique constraint, which ON CONFLICT requires.
  const { data, error } = await db
    .from("leads")
    .upsert(clean, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("business_name");
  if (error) throw new Error(error.message);

  const saved = data?.length || 0;
  return {
    saved,
    skipped: clean.length - saved,
    names: (data || []).map((d: any) => d.business_name),
  };
}

export async function listLeads(opts: { status?: string; limit?: number } = {}): Promise<Lead[]> {
  const db = supabaseAdmin();
  let q = db.from("leads").select("*").order("created_at", { ascending: false });
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  const { data, error } = await q.limit(opts.limit ?? 200);
  if (error) throw new Error(error.message);
  return (data as Lead[]) || [];
}

export async function updateLead(
  id: string,
  patch: { status?: string; notes?: string }
): Promise<void> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.status && (LEAD_STATUSES as readonly string[]).includes(patch.status)) {
    update.status = patch.status;
  }
  if (patch.notes !== undefined) update.notes = patch.notes ? String(patch.notes).slice(0, 2000) : null;
  if (Object.keys(update).length === 0) return;
  const { error } = await db.from("leads").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function leadCounts(): Promise<Record<string, number>> {
  const db = supabaseAdmin();
  const { data } = await db.from("leads").select("status");
  const counts: Record<string, number> = { total: 0 };
  for (const r of (data as any[]) || []) {
    counts.total += 1;
    counts[r.status] = (counts[r.status] || 0) + 1;
  }
  return counts;
}

const CSV_COLUMNS: (keyof Lead)[] = [
  "business_name",
  "trade",
  "city",
  "pain",
  "channel",
  "contact",
  "opener",
  "status",
  "source",
  "created_at",
];

/** Spreadsheet export — opens directly in Sheets or Excel. */
export function leadsToCsv(leads: Lead[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const header = CSV_COLUMNS.join(",");
  const rows = leads.map((l) => CSV_COLUMNS.map((c) => esc(l[c])).join(","));
  return [header, ...rows].join("\n");
}
