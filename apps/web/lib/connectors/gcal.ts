import { ymd, appTimezone } from "../time";

/**
 * Google Calendar via the calendar's "Secret address in iCal format"
 * (Google Calendar → Settings → your calendar → Integrate calendar).
 * No OAuth needed for a personal app; the URL itself is the credential.
 *
 * Parsing is intentionally small: today's one-off events always work;
 * recurring events cover the common FREQ=DAILY/WEEKLY/MONTHLY/YEARLY
 * cases (COUNT-limited series are treated as still active).
 */

export type GCalCreds = { ics_url: string };

export type CalendarEvent = {
  summary: string;
  time: string; // "all day" or "HH:MM"
};

// ICS folds long lines; continuations start with a space or tab.
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

type VEvent = Record<string, { params: string; value: string }[]>;

function parseEvents(lines: string[]): VEvent[] {
  const events: VEvent[] = [];
  let cur: VEvent | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur) events.push(cur);
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const left = line.slice(0, i);
      const value = line.slice(i + 1);
      const semi = left.indexOf(";");
      const name = (semi < 0 ? left : left.slice(0, semi)).toUpperCase();
      const params = semi < 0 ? "" : left.slice(semi + 1);
      (cur[name] = cur[name] || []).push({ params, value });
    }
  }
  return events;
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// "20260612", "20260612T090000" (wall time), "20260612T140000Z" (UTC).
function startParts(dt: string, tz: string): { ymd: string; time: string } {
  if (/^\d{8}$/.test(dt)) {
    return { ymd: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`, time: "all day" };
  }
  if (/Z$/.test(dt)) {
    const d = new Date(
      Date.UTC(
        +dt.slice(0, 4), +dt.slice(4, 6) - 1, +dt.slice(6, 8),
        +dt.slice(9, 11), +dt.slice(11, 13), +dt.slice(13, 15) || 0
      )
    );
    const hm = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d);
    return { ymd: ymd(d, tz), time: hm };
  }
  // Wall time (with or without TZID); assume it matches the app timezone.
  return {
    ymd: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
    time: `${dt.slice(9, 11)}:${dt.slice(11, 13)}`,
  };
}

function rrule(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) out[k.toUpperCase()] = v;
  }
  return out;
}

export async function fetchCalendarToday(creds: GCalCreds): Promise<CalendarEvent[]> {
  const res = await fetch(creds.ics_url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Calendar: HTTP ${res.status} fetching the iCal URL`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new Error("Calendar: that URL didn't return an iCal feed — use the SECRET iCal address");
  }

  const tz = appTimezone();
  const today = ymd(new Date(), tz);
  const todayCompact = today.replace(/-/g, "");
  const weekday = BYDAY[new Date(`${today}T12:00:00Z`).getUTCDay()];

  const out: CalendarEvent[] = [];
  for (const ev of parseEvents(unfold(text))) {
    if (ev.STATUS?.[0]?.value === "CANCELLED") continue;
    const dtstart = ev.DTSTART?.[0];
    if (!dtstart) continue;
    const start = startParts(dtstart.value, tz);
    if (start.ymd > today) continue;

    let occursToday = false;
    const rule = ev.RRULE?.[0] ? rrule(ev.RRULE[0].value) : null;
    if (!rule) {
      occursToday = start.ymd === today;
    } else {
      const until = rule.UNTIL ? rule.UNTIL.slice(0, 8) : null;
      if (until && until < todayCompact) continue;
      switch (rule.FREQ) {
        case "DAILY":
          occursToday = true;
          break;
        case "WEEKLY": {
          const days = rule.BYDAY
            ? rule.BYDAY.split(",").map((d) => d.slice(-2))
            : [BYDAY[new Date(`${start.ymd}T12:00:00Z`).getUTCDay()]];
          occursToday = days.includes(weekday);
          break;
        }
        case "MONTHLY":
          occursToday = start.ymd.slice(8, 10) === today.slice(8, 10);
          break;
        case "YEARLY":
          occursToday = start.ymd.slice(5) === today.slice(5);
          break;
      }
      const exdates = (ev.EXDATE || []).map((e) => e.value.slice(0, 8));
      if (exdates.includes(todayCompact)) occursToday = false;
    }
    if (!occursToday) continue;

    out.push({ summary: ev.SUMMARY?.[0]?.value || "(no title)", time: start.time });
  }

  out.sort((a, b) =>
    a.time === "all day" ? -1 : b.time === "all day" ? 1 : a.time.localeCompare(b.time)
  );
  return out;
}
