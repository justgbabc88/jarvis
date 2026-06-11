/** Date helpers that respect APP_TIMEZONE so "today"/"yesterday" match the operator's day. */

export function appTimezone(): string {
  return process.env.APP_TIMEZONE || "America/New_York";
}

/** YYYY-MM-DD for a given Date in the app timezone. */
export function ymd(d: Date = new Date(), tz: string = appTimezone()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function todayYmd(): string {
  return ymd(new Date());
}

export function yesterdayYmd(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return ymd(d);
}

/** First day of the current month, in app tz, as YYYY-MM-DD. */
export function monthStartYmd(): string {
  const t = todayYmd();
  return `${t.slice(0, 7)}-01`;
}

export function nDaysAgoYmd(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return ymd(d);
}
