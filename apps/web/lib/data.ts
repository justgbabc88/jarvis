import { supabaseAdmin } from "./supabase";
import { monthStartYmd, todayYmd, yesterdayYmd } from "./time";

export type Business = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  settings: Record<string, any>;
  sort_order: number;
};

export type BusinessCard = Business & {
  monthRevenueCents: number;
  monthSpendCents: number;
  todayRevenueCents: number;
  todaySpendCents: number;
  hasSnapshots: boolean;
};

export async function listBusinesses(activeOnly = true): Promise<Business[]> {
  const db = supabaseAdmin();
  let q = db.from("businesses").select("*").order("sort_order").order("created_at");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data as Business[]) || [];
}

/** Build the dashboard cards from stored metric snapshots (synced by the worker). */
export async function getBusinessCards(): Promise<BusinessCard[]> {
  const db = supabaseAdmin();
  const businesses = await listBusinesses(true);
  if (businesses.length === 0) return [];

  const monthStart = monthStartYmd();
  const today = todayYmd();

  const { data: snaps } = await db
    .from("metric_snapshots")
    .select("business_id, metric_date, revenue_cents, ad_spend_cents")
    .gte("metric_date", monthStart)
    .lte("metric_date", today);

  const byBiz = new Map<string, any[]>();
  for (const s of (snaps as any[]) || []) {
    const arr = byBiz.get(s.business_id) || [];
    arr.push(s);
    byBiz.set(s.business_id, arr);
  }

  return businesses.map((b) => {
    const rows = byBiz.get(b.id) || [];
    const monthRevenueCents = rows.reduce((a, r) => a + (r.revenue_cents || 0), 0);
    const monthSpendCents = rows.reduce((a, r) => a + (r.ad_spend_cents || 0), 0);
    const todayRow = rows.find((r) => r.metric_date === today);
    return {
      ...b,
      monthRevenueCents,
      monthSpendCents,
      todayRevenueCents: todayRow?.revenue_cents || 0,
      todaySpendCents: todayRow?.ad_spend_cents || 0,
      hasSnapshots: rows.length > 0,
    };
  });
}

export type DailyMetric = {
  business_id: string;
  metric_date: string;
  revenue_cents: number;
  ad_spend_cents: number;
};

/** Per-day metrics for the last `days` days, oldest first (for Q&A/briefings). */
export async function getDailyMetrics(days = 60): Promise<DailyMetric[]> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data } = await db
    .from("metric_snapshots")
    .select("business_id, metric_date, revenue_cents, ad_spend_cents")
    .gte("metric_date", since)
    .order("metric_date");
  return (data as DailyMetric[]) || [];
}

export type ActivityItem = {
  id: string;
  type: string;
  summary: string;
  created_at: string;
  business_id: string | null;
};

/** "What Jarvis worked on yesterday." */
export async function getYesterdayActivity(): Promise<ActivityItem[]> {
  const db = supabaseAdmin();
  const start = yesterdayYmd();
  const end = todayYmd();
  const { data } = await db
    .from("activity_log")
    .select("id, type, summary, created_at, business_id")
    .gte("created_at", `${start}T00:00:00`)
    .lt("created_at", `${end}T00:00:00`)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data as ActivityItem[]) || [];
}

export async function getPendingApprovals() {
  const db = supabaseAdmin();
  const { data } = await db
    .from("approvals")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return data || [];
}

export async function getActiveGoals() {
  const db = supabaseAdmin();
  const { data } = await db
    .from("goals")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  return data || [];
}
