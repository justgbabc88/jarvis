import { getProviderCreds } from "./connectors";
import { fetchTodayEvents, CalendarEvent, CalendarCreds } from "./connectors/calendar";
import { fetchDueTasks, TaskItem, ClickUpCreds } from "./connectors/clickup";

/**
 * "What's on my plate today" — calendar events + due/overdue tasks,
 * pulled live from whatever calendar/task connections exist. Feeds the
 * dashboard today panel, the voice context, and the morning briefing.
 */

export type TodayAgenda = {
  events: CalendarEvent[];
  tasks: TaskItem[];
  connected: { calendar: boolean; tasks: boolean };
  errors: string[];
};

export async function getTodayAgenda(): Promise<TodayAgenda> {
  const [calendar, clickup] = await Promise.all([
    getProviderCreds<CalendarCreds>("calendar_ics"),
    getProviderCreds<ClickUpCreds>("clickup"),
  ]);

  const errors: string[] = [];
  let events: CalendarEvent[] = [];
  let tasks: TaskItem[] = [];

  await Promise.all([
    (async () => {
      if (!calendar) return;
      try {
        events = await fetchTodayEvents(calendar);
      } catch (e: any) {
        errors.push(`Calendar: ${e.message}`);
      }
    })(),
    (async () => {
      if (!clickup) return;
      try {
        tasks = await fetchDueTasks(clickup);
      } catch (e: any) {
        errors.push(`Tasks: ${e.message}`);
      }
    })(),
  ]);

  return {
    events,
    tasks,
    connected: { calendar: Boolean(calendar), tasks: Boolean(clickup) },
    errors,
  };
}

/** Compact plain-text rendering for prompts (voice, briefing). */
export function agendaToText(agenda: TodayAgenda): string {
  const ev =
    agenda.events
      .map((e) => `- ${e.allDay ? "all day" : e.start} ${e.title}${e.location ? ` (${e.location})` : ""}`)
      .join("\n") || (agenda.connected.calendar ? "no events today" : "no calendar connected");
  const ts =
    agenda.tasks
      .map((t) => `- ${t.title}${t.overdue ? ` (overdue, was due ${t.due})` : ""}${t.list ? ` [${t.list}]` : ""}`)
      .join("\n") || (agenda.connected.tasks ? "nothing due" : "no task tool connected");
  return `CALENDAR TODAY:\n${ev}\n\nTASKS DUE TODAY / OVERDUE:\n${ts}`;
}
