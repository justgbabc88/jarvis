import { supabaseAdmin } from "./supabase";
import { decryptJson } from "./crypto";
import { fetchClickUpTodayTasks, ClickUpCreds, ClickUpTask } from "./connectors/clickup";
import { fetchCalendarUpcoming, GCalCreds, CalendarEvent, UpcomingEvent } from "./connectors/gcal";
import { todayYmd } from "./time";

export type TodayAgenda = {
  events: CalendarEvent[];
  upcoming: UpcomingEvent[]; // next 7 days incl. today
  tasks: ClickUpTask[];
  connected: { calendar: boolean; clickup: boolean };
  errors: string[];
};

function decode<T>(credentials: unknown): T | null {
  if (!credentials) return null;
  try {
    if (typeof credentials === "string") return decryptJson<T>(credentials);
    return credentials as T;
  } catch {
    return null;
  }
}

/** Today's calendar events + due/overdue ClickUp tasks, across all connections. */
export async function getTodayAgenda(): Promise<TodayAgenda> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("connections")
    .select("id, provider, credentials")
    .in("provider", ["clickup", "google_calendar"])
    .eq("status", "connected");

  const rows = (data as any[]) || [];
  const agenda: TodayAgenda = {
    events: [],
    upcoming: [],
    tasks: [],
    connected: { calendar: false, clickup: false },
    errors: [],
  };

  const today = todayYmd();
  await Promise.all(
    rows.map(async (row) => {
      try {
        if (row.provider === "google_calendar") {
          const creds = decode<GCalCreds>(row.credentials);
          if (!creds?.ics_url) return;
          agenda.connected.calendar = true;
          const upcoming = await fetchCalendarUpcoming(creds, 7);
          agenda.upcoming.push(...upcoming);
          agenda.events.push(...upcoming.filter((e) => e.date === today));
        } else if (row.provider === "clickup") {
          const creds = decode<ClickUpCreds>(row.credentials);
          if (!creds?.api_token) return;
          agenda.connected.clickup = true;
          agenda.tasks.push(...(await fetchClickUpTodayTasks(creds)));
        }
      } catch (e: any) {
        agenda.errors.push(e.message);
      }
    })
  );

  agenda.events.sort((a, b) =>
    a.time === "all day" ? -1 : b.time === "all day" ? 1 : a.time.localeCompare(b.time)
  );
  agenda.tasks.sort((a, b) => (a.dueMs || 0) - (b.dueMs || 0));
  return agenda;
}

/** Compact plain-text rendering for prompts (voice, briefing, agents). */
export function agendaToText(agenda: TodayAgenda): string {
  const ev =
    agenda.events.map((e) => `- ${e.time} ${e.summary}`).join("\n") ||
    (agenda.connected.calendar ? "no events today" : "no calendar connected");
  const ts =
    agenda.tasks
      .map((t) => `- ${t.name}${t.overdue ? " (overdue)" : ""}${t.listName ? ` [${t.listName}]` : ""}`)
      .join("\n") || (agenda.connected.clickup ? "nothing due" : "no task tool connected");
  return `CALENDAR TODAY:\n${ev}\n\nTASKS DUE TODAY / OVERDUE:\n${ts}`;
}
