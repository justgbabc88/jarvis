"use client";

import { useEffect, useState } from "react";

type Agent = {
  id: string;
  name: string;
  description: string | null;
  schedule_cron: string | null;
  enabled: boolean;
  last_run_at: string | null;
};

type Run = {
  id: string;
  agent_id: string | null;
  trigger: string;
  status: string;
  summary: string | null;
  label: string | null;
  started_at: string;
  finished_at: string | null;
};

const SCHEDULES: { label: string; cron: string | null }[] = [
  { label: "Manual only", cron: null },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Daily · 7am", cron: "0 7 * * *" },
  { label: "Daily · 9am", cron: "0 9 * * *" },
  { label: "Weekdays · 9am", cron: "0 9 * * 1-5" },
  { label: "Mondays · 9am", cron: "0 9 * * 1" },
];

function scheduleLabel(cron: string | null): string {
  return SCHEDULES.find((s) => s.cron === cron)?.label || cron || "Manual only";
}

function statusColor(s: string): string {
  if (s === "succeeded") return "text-good";
  if (s === "failed") return "text-bad";
  if (s === "awaiting_approval") return "text-warn";
  return "text-accent2";
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [schedule, setSchedule] = useState<string | "">("");
  const [customCron, setCustomCron] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/agents");
    const data = await res.json();
    setAgents(data.agents || []);
    setRuns(data.runs || []);
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 20000); // keep run statuses fresh
    return () => clearInterval(t);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim() || !job.trim()) {
      setError("Give the agent a name and describe its job.");
      return;
    }
    setCreating(true);
    const cron = schedule === "custom" ? customCron.trim() : schedule || null;
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: job.trim(),
        schedule_cron: cron || null,
        enabled: Boolean(cron), // deploying with a schedule turns it on
      }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Could not create the agent.");
      return;
    }
    setName("");
    setJob("");
    setSchedule("");
    setCustomCron("");
    load();
  }

  async function runNow(id: string) {
    setRunningId(id);
    await fetch(`/api/agents/${id}/run`, { method: "POST" });
    setRunningId(null);
    load();
  }

  async function toggle(a: Agent) {
    await fetch(`/api/agents/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this agent? Its run history will be removed too.")) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Agents</h1>
        <p className="text-sm text-muted">
          Describe a job in plain English, deploy it on a schedule, and review everything it does.
          Anything that sends, posts, deletes, or spends waits on the Approvals screen.
        </p>
      </div>

      {/* Builder */}
      <form onSubmit={create} className="card space-y-3">
        <div className="card-title">Build an agent</div>
        <div>
          <label className="mb-1 block text-sm text-muted">Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Morning numbers analyst"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-muted">The job, in your words</label>
          <textarea
            className="input min-h-28"
            value={job}
            onChange={(e) => setJob(e.target.value)}
            placeholder="Every morning, pull yesterday's revenue and ad spend for each business. Flag anything unusual — spend up but revenue down, ROAS under 2, a day with zero sales. Suggest one concrete fix when something looks off."
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-sm text-muted">Schedule</label>
            <select
              className="input"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
            >
              {SCHEDULES.map((s) => (
                <option key={s.label} value={s.cron || ""}>
                  {s.label}
                </option>
              ))}
              <option value="custom">Custom cron…</option>
            </select>
          </div>
          {schedule === "custom" && (
            <div>
              <label className="mb-1 block text-sm text-muted">Cron (min hour dom mon dow)</label>
              <input
                className="input"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                placeholder="30 6 * * 1-5"
              />
            </div>
          )}
          <button className="btn btn-primary" disabled={creating}>
            {creating ? "Deploying…" : schedule ? "Deploy agent" : "Create agent"}
          </button>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>

      {/* Agent list */}
      <div className="space-y-3">
        {agents.length === 0 ? (
          <p className="text-sm text-muted">No agents yet — describe one above.</p>
        ) : (
          agents.map((a) => (
            <div key={a.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <span className={`pill ${a.enabled ? "text-good" : ""}`}>
                      {a.enabled ? "deployed" : "paused"}
                    </span>
                    <span className="pill">{scheduleLabel(a.schedule_cron)}</span>
                  </div>
                  {a.description && (
                    <p className="mt-1 max-w-2xl text-sm text-muted">{a.description}</p>
                  )}
                  {a.last_run_at && (
                    <p className="mt-1 text-xs text-muted">
                      last ran {new Date(a.last_run_at).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="btn btn-primary"
                    onClick={() => runNow(a.id)}
                    disabled={runningId === a.id}
                  >
                    {runningId === a.id ? "Running…" : "Run now"}
                  </button>
                  {a.schedule_cron && (
                    <button className="btn" onClick={() => toggle(a)}>
                      {a.enabled ? "Pause" : "Deploy"}
                    </button>
                  )}
                  <button className="btn text-bad" onClick={() => remove(a.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Run history */}
      <div className="card">
        <div className="card-title mb-3">Run history</div>
        {runs.length === 0 ? (
          <p className="text-sm text-muted">No runs yet.</p>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => {
              const agent = agents.find((a) => a.id === r.agent_id);
              const title = agent?.name || r.label || "One-off job";
              return (
                <li key={r.id} className="rounded-xl border border-line bg-ink/40 p-3">
                  <button
                    className="flex w-full items-center justify-between gap-3 text-left"
                    onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{title}</span>
                      <span className="ml-2 text-xs text-muted">
                        {r.trigger} · {new Date(r.started_at).toLocaleString()}
                      </span>
                    </div>
                    <span className={`pill ${statusColor(r.status)}`}>
                      {r.status.replace("_", " ")}
                    </span>
                  </button>
                  {openRun === r.id && r.summary && (
                    <p className="mt-2 whitespace-pre-wrap border-t border-line pt-2 text-sm text-white/85">
                      {r.summary}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
