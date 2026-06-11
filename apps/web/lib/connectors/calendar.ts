import { ymd, appTimezone } from "../time";

/**
 * Calendar via a private ICS feed URL — free and OAuth-free.
 * Google Calendar: Settings → your calendar → "Secret address in iCal
 * format". Apple/Outlook publish similar URLs.
 *
 * We parse just enough of RFC 5545 to answer one question well:
 * "what's on my calendar today?" — including the common recurrence
 * patterns (daily/weekly/monthly/yearly RRULEs with INTERVAL, BYDAY,
 * UNTIL and EXDATE).
 */

export type CalendarCreds = { ics_url: string };

export type CalendarEvent = {
  title: string;
  start: string;       // "HH:MM" in app tz, or "all-day"
  location?: string;
  allDay: boolean;
};

type RawEvent = Record<string, { value: string; params: Record<string, string> }[]>;

/** Unfold long lines (RFC 5545 §3.1) and split into VEVENT property maps. */
function parseEvents(ics: string): RawEvent[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events: RawEvent[] = [];
  let current: RawEvent | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const left = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [name, ...paramParts] = left.split(";");
    const params: Record<string, string> = {};
    for (const p of paramParts) {
      const [k, v] = p.split("=");
      if (k && v) params[k.toUpperCase()] = v;
    }
    const key = name.toUpperCase();
    (current[key] ||= []).push({ value, params });
  }
  return events;
}

type ParsedStart = { date: string; time: string | null }; // date: YYYY-MM-DD in app tz

/** Parse a DTSTART/EXDATE value into the app-timezone date (+ local HH:MM). */
function parseIcsDate(value: string, params: Record<string, string>, tz: string): ParsedStart | null {
  // All-day: VALUE=DATE, e.g. 20260611
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (params["VALUE"] === "DATE" || dateOnly) {
    const m = dateOnly || /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return null;
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
  }

  // Date-time: 20260611T143000Z (UTC) or 20260611T143000 (+TZID / floating)
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/.exec(value);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, , z] = m;

  if (z === "Z") {
    const d = new Date(Date.UTC(+Y, +Mo - 1, +D, +H, +Mi));
    const date = ymd(d, tz);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d);
    return { date, time };
  }

  // TZID or floating local time. Treating the named zone as the app zone
  // is exact when they match (the common case for your own calendar) and
  // a tolerable approximation otherwise.
  return { date: `${Y}-${Mo}-${D}`, time: `${H}:${Mi}` };
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function daysBetweenYmd(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Does a recurring event starting on `start` occur on `today`? */
function rruleHitsToday(rrule: string, start: string, today: string): boolean {
  const parts: Record<string, string> = {};
  for (const kv of rrule.split(";")) {
    const [k, v] = kv.split("=");
    if (k && v) parts[k.toUpperCase()] = v;
  }
  const freq = parts["FREQ"];
  const interval = Math.max(1, parseInt(parts["INTERVAL"] || "1", 10) || 1);
  const diff = daysBetweenYmd(start, today);
  if (diff < 0) return false;

  if (parts["UNTIL"]) {
    const u = /^(\d{4})(\d{2})(\d{2})/.exec(parts["UNTIL"]);
    if (u && today > `${u[1]}-${u[2]}-${u[3]}`) return false;
  }

  const todayDow = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()];
  const startDate = new Date(`${start}T12:00:00Z`);
  const todayDate = new Date(`${today}T12:00:00Z`);

  switch (freq) {
    case "DAILY":
      return diff % interval === 0;
    case "WEEKLY": {
      const byday = (parts["BYDAY"] || WEEKDAYS[startDate.getUTCDay()]).split(",");
      if (!byday.includes(todayDow)) return false;
      // weeks since the start of the start's week
      const weekDiff = Math.floor((diff + startDate.getUTCDay()) / 7);
      return weekDiff % interval === 0;
    }
    case "MONTHLY": {
      if (todayDate.getUTCDate() !== startDate.getUTCDate()) return false;
      const monthDiff =
        (todayDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
        (todayDate.getUTCMonth() - startDate.getUTCMonth());
      return monthDiff >= 0 && monthDiff % interval === 0;
    }
    case "YEARLY":
      return (
        todayDate.getUTCDate() === startDate.getUTCDate() &&
        todayDate.getUTCMonth() === startDate.getUTCMonth()
      );
    default:
      return false;
  }
}

/** Fetch the feed and return today's events, sorted (all-day first, then by time). */
export async function fetchTodayEvents(
  creds: CalendarCreds,
  today: string = ymd(new Date()),
  tz: string = appTimezone()
): Promise<CalendarEvent[]> {
  if (!creds?.ics_url || !/^https?:\/\//.test(creds.ics_url)) {
    throw new Error("a valid ICS URL is required (Google Calendar → secret iCal address)");
  }
  const res = await fetch(creds.ics_url, { headers: { "User-Agent": "jarvis-calendar" } });
  if (!res.ok) throw new Error(`calendar feed returned ${res.status}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("URL did not return an ICS calendar");

  const out: CalendarEvent[] = [];
  for (const ev of parseEvents(text)) {
    const dtstart = ev["DTSTART"]?.[0];
    if (!dtstart) continue;
    const start = parseIcsDate(dtstart.value, dtstart.params, tz);
    if (!start) continue;

    const rrule = ev["RRULE"]?.[0]?.value;
    let occursToday = start.date === today;
    if (!occursToday && rrule) occursToday = rruleHitsToday(rrule, start.date, today);
    if (!occursToday) continue;

    // EXDATE: skip cancelled instances of recurring events.
    const exdates = (ev["EXDATE"] || []).flatMap((e) =>
      e.value.split(",").map((v) => parseIcsDate(v.trim(), e.params, tz)?.date)
    );
    if (exdates.includes(today)) continue;

    if ((ev["STATUS"]?.[0]?.value || "").toUpperCase() === "CANCELLED") continue;

    out.push({
      title: ev["SUMMARY"]?.[0]?.value?.replace(/\\([,;])/g, "$1") || "(untitled)",
      start: start.time || "all-day",
      allDay: !start.time,
      location: ev["LOCATION"]?.[0]?.value?.replace(/\\([,;])/g, "$1") || undefined,
    });
  }

  out.sort((a, b) => (a.allDay ? "" : a.start).localeCompare(b.allDay ? "" : b.start));
  return out;
}
