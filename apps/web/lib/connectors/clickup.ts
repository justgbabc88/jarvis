import { ymd, appTimezone } from "../time";

/**
 * ClickUp tasks via a personal API token (ClickUp → Settings → Apps).
 * Read-only: powers the dashboard "today" panel and the briefing with
 * tasks that are due today or overdue.
 */

const API = "https://api.clickup.com/api/v2";

export type ClickUpCreds = { api_token: string };

export type TaskItem = {
  title: string;
  due: string | null;       // YYYY-MM-DD in app tz
  overdue: boolean;
  status?: string;
  list?: string;
  url?: string;
};

async function cu(path: string, creds: ClickUpCreds): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: creds.api_token },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`ClickUp API error (${res.status}): ${json.err || "check the API token"}`);
  }
  return json;
}

/** Live credential check used by the Connections "Test" button. */
export async function verifyClickUp(creds: ClickUpCreds): Promise<string> {
  if (!creds?.api_token) throw new Error("an API token is required");
  const me = await cu("/user", creds);
  return me?.user?.username || me?.user?.email || "ok";
}

/** Tasks due today or overdue (open tasks only), across all teams. */
export async function fetchDueTasks(creds: ClickUpCreds): Promise<TaskItem[]> {
  const today = ymd(new Date());
  const teams = (await cu("/team", creds))?.teams || [];

  // End of today in the app timezone, as a UTC ms timestamp.
  // Take midnight tomorrow (app tz ≈ UTC offset within ±14h, so add a
  // generous bound by formatting round-trip): simplest reliable approach —
  // tomorrow's date at 00:00 UTC plus 14h covers every timezone; ClickUp
  // due dates are usually date-level anyway, so we filter precisely below.
  const endOfTodayUtcMs = Date.parse(`${today}T23:59:59Z`) + 14 * 3600 * 1000;

  const out: TaskItem[] = [];
  for (const team of teams.slice(0, 5)) {
    const data = await cu(
      `/team/${team.id}/task?due_date_lt=${endOfTodayUtcMs}&subtasks=true&include_closed=false`,
      creds
    );
    for (const t of data?.tasks || []) {
      if (!t.due_date) continue;
      const dueYmd = ymd(new Date(Number(t.due_date)), appTimezone());
      if (dueYmd > today) continue; // the ms bound above is intentionally loose
      out.push({
        title: t.name,
        due: dueYmd,
        overdue: dueYmd < today,
        status: t.status?.status,
        list: t.list?.name,
        url: t.url,
      });
    }
  }

  out.sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  return out.slice(0, 50);
}
