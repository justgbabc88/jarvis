export type DateRange = { since: string; until: string }; // YYYY-MM-DD inclusive

export type DailyAmount = { date: string; cents: number };

export type RevenueResult = {
  totalCents: number;
  byDay: DailyAmount[];
  raw?: unknown;
};

export type SpendResult = {
  totalCents: number;
  byDay: DailyAmount[];
  raw?: unknown;
};

export function toCents(amount: number | string): number {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}
