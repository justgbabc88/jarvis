import { ymd, appTimezone } from "../time";

/**
 * ClickUp tasks via the v2 API, authenticated with a personal API token
 * (ClickUp → avatar → Settings → Apps → API Token, starts with "pk_").
 *
 * "Today" = open tasks assigned to the token's user that are due today
 * or overdue. Tasks without due dates are excluded on purpose — this
 * feeds the "what's on my plate today" card, not a full task browser.
 */

const API = "https://api.clickup.com/api/v2";

export type ClickUpCreds = { api_token: string; list_id?: string; list_name?: string };

export type ClickUpList = { id: string; name: string };

export type ClickUpTask = {
  id: string;
  name: string;
  status: string;
  listName: string;
  dueMs: number | null;
  overdue: boolean;
  url: string;
};

async function cu(path: string, token: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: token } });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.err) {
    throw new Error(`ClickUp: ${json.err || `HTTP ${res.status}`}`);
  }
  return json;
}

export async function clickupWhoAmI(creds: ClickUpCreds): Promise<{ id: number; username: string }> {
  const j = await cu("/user", creds.api_token);
  return j.user;
}

/** Every list across all teams/spaces, labeled "Space / Folder / List". */
export async function fetchClickUpLists(creds: ClickUpCreds): Promise<ClickUpList[]> {
  const token = creds.api_token;
  const out: ClickUpList[] = [];
  const teams = (await cu("/team", token)).teams || [];
  for (const team of teams) {
    const spaces = (await cu(`/team/${team.id}/space?archived=false`, token)).spaces || [];
    for (const space of spaces) {
      const [folders, folderless] = await Promise.all([
        cu(`/space/${space.id}/folder?archived=false`, token),
        cu(`/space/${space.id}/list?archived=false`, token),
      ]);
      for (const list of folderless.lists || []) {
        out.push({ id: String(list.id), name: `${space.name} / ${list.name}` });
      }
      for (const folder of folders.folders || []) {
        for (const list of folder.lists || []) {
          out.push({ id: String(list.id), name: `${space.name} / ${folder.name} / ${list.name}` });
        }
      }
    }
  }
  return out;
}

/**
 * Mark a task complete. ClickUp statuses are list-specific, so find the
 * task's list, pick its "closed"/"done"-type status, and set it.
 */
export async function closeClickUpTask(
  creds: ClickUpCreds,
  taskId: string
): Promise<{ name: string; status: string }> {
  const task = await cu(`/task/${taskId}`, creds.api_token);
  let statusName = "complete";
  const listId = task.list?.id;
  if (listId) {
    const list = await cu(`/list/${listId}`, creds.api_token);
    const statuses: any[] = list.statuses || [];
    const target =
      statuses.find((s) => s.type === "closed") ||
      statuses.find((s) => s.type === "done") ||
      statuses[statuses.length - 1];
    if (target?.status) statusName = target.status;
  }
  const res = await fetch(`${API}/task/${taskId}`, {
    method: "PUT",
    headers: { Authorization: creds.api_token, "Content-Type": "application/json" },
    body: JSON.stringify({ status: statusName }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.err) throw new Error(`ClickUp: ${json.err || `HTTP ${res.status}`}`);
  return { name: task.name, status: statusName };
}

export async function fetchClickUpTodayTasks(creds: ClickUpCreds): Promise<ClickUpTask[]> {
  // End of today in the app timezone, as epoch ms.
  const endOfToday = new Date(`${ymd(new Date(), appTimezone())}T23:59:59`);
  const endMs = endOfToday.getTime();
  const startOfTodayMs = endMs - 86399000;

  const pushTasks = (tasks: ClickUpTask[], rows: any[]) => {
    for (const task of rows) {
      const dueMs = task.due_date ? Number(task.due_date) : null;
      tasks.push({
        id: task.id,
        name: task.name,
        status: task.status?.status || "open",
        listName: task.list?.name || "",
        dueMs,
        overdue: dueMs !== null && dueMs < startOfTodayMs,
        url: task.url,
      });
    }
  };

  const tasks: ClickUpTask[] = [];
  if (creds.list_id) {
    // Scoped to one list: every open task due today or overdue, any assignee.
    const j = await cu(
      `/list/${creds.list_id}/task?due_date_lt=${endMs + 1}&include_closed=false&order_by=due_date`,
      creds.api_token
    );
    pushTasks(tasks, j.tasks || []);
  } else {
    // All lists: open tasks assigned to the token's user.
    const me = await clickupWhoAmI(creds);
    const teams = (await cu("/team", creds.api_token)).teams || [];
    for (const t of teams) {
      const j = await cu(
        `/team/${t.id}/task?due_date_lt=${endMs + 1}&include_closed=false&assignees[]=${me.id}&order_by=due_date`,
        creds.api_token
      );
      pushTasks(tasks, j.tasks || []);
    }
  }
  tasks.sort((a, b) => (a.dueMs || 0) - (b.dueMs || 0));
  return tasks;
}
