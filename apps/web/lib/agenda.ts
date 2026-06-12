import { supabaseAdmin } from "./supabase";
import { decryptJson } from "./crypto";
import { fetchClickUpTodayTasks, ClickUpCreds, ClickUpTask } from "./connectors/clickup";
import { fetchCalendarToday, GCalCreds, CalendarEvent } from "./connectors/gcal";

export type TodayAgenda = {
  events: CalendarEvent[];
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
    tasks: [],
    connected: { calendar: false, clickup: false },
    errors: [],
  };

  await Promise.all(
    rows.map(async (row) => {
      try {
        if (row.provider === "google_calendar") {
          const creds = decode<GCalCreds>(row.credentials);
          if (!creds?.ics_url) return;
          agenda.connected.calendar = true;
          agenda.events.push(...(await fetchCalendarToday(creds)));
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
