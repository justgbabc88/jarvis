import { appTimezone } from "./time";

// Minimal 5-field cron matcher: "minute hour day-of-month month day-of-week".
// Supports *, numbers, lists (1,2,3), ranges (1-5), and steps ("*/15", "1-30/5").
// Evaluated in the app timezone so "0 9 * * *" means 9am YOUR time.
//
// The worker pings /api/agents/run-due once a minute; this answers
// "does this expression match the current minute?"

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(",").some((part) => {
    const [rangeStr, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (!step || step < 1) return false;

    let lo = min;
    let hi = max;
    if (rangeStr !== "*") {
      if (rangeStr.includes("-")) {
        const [a, b] = rangeStr.split("-").map((n) => parseInt(n, 10));
        if (Number.isNaN(a) || Number.isNaN(b)) return false;
        lo = a;
        hi = b;
      } else {
        const n = parseInt(rangeStr, 10);
        if (Number.isNaN(n)) return false;
        // "5" exact; "5/10" means starting at 5 with step 10
        if (!stepStr) return value === n;
        lo = n;
        hi = max;
      }
    }
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function nowParts(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    minute: "numeric",
    hour: "numeric",
    hour12: false,
    day: "numeric",
    month: "numeric",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    minute: parseInt(get("minute"), 10),
    hour: parseInt(get("hour"), 10) % 24, // "24" → 0 in some ICU versions
    dom: parseInt(get("day"), 10),
    month: parseInt(get("month"), 10),
    dow: DOW[get("weekday")] ?? 0,
  };
}

export function cronMatches(expr: string, date: Date = new Date(), tz: string = appTimezone()): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [m, h, dom, mon, dow] = fields;
  const now = nowParts(date, tz);
  return (
    fieldMatches(m, now.minute, 0, 59) &&
    fieldMatches(h, now.hour, 0, 23) &&
    fieldMatches(dom, now.dom, 1, 31) &&
    fieldMatches(mon, now.month, 1, 12) &&
    fieldMatches(dow, now.dow, 0, 6)
  );
}

export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];
  return fields.every((f, i) =>
    f.split(",").every((part) => /^(\*|\d+(-\d+)?)(\/\d+)?$/.test(part)) &&
    // sanity: any numeric values fall in range
    f.split(",").every((part) => {
      const nums = part.match(/\d+/g)?.map(Number) ?? [];
      const stepIdx = part.includes("/") ? nums.length - 1 : nums.length;
      return nums.slice(0, stepIdx).every((n) => n >= ranges[i][0] && n <= ranges[i][1]);
    })
  );
}
