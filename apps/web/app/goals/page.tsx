"use client";

import { useEffect, useState } from "react";

type Goal = { id: string; title: string; description: string | null; target_date: string | null; status: string };
type Suggestion = {
  id: string;
  goal_id: string;
  kind: string;
  title: string;
  rationale: string | null;
  job_spec: string | null;
  status: string;
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [date, setDate] = useState("");
  const [busyGoal, setBusyGoal] = useState<string | null>(null);
  const [busySuggestion, setBusySuggestion] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/goals");
    const data = await res.json();
    setGoals(data.goals || []);
    setSuggestions(data.suggestions || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), description: desc.trim() || undefined, target_date: date || undefined }),
    });
    setTitle("");
    setDesc("");
    setDate("");
    load();
  }

  async function suggest(goalId: string) {
    setBusyGoal(goalId);
    await fetch(`/api/goals/${goalId}/suggest`, { method: "POST" });
    setBusyGoal(null);
    load();
  }

  async function decide(suggestionId: string, decision: "approved" | "rejected") {
    setBusySuggestion(suggestionId);
    await fetch(`/api/suggestions/${suggestionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusySuggestion(null);
    load();
  }

  async function removeGoal(id: string) {
    if (!confirm("Delete this goal and its suggestions?")) return;
    await fetch(`/api/goals/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Goals</h1>
        <p className="text-sm text-muted">
          Set a goal. Jarvis looks at it alongside your numbers and proposes revenue moves and
          research. Approve one and it gets queued for an agent.
        </p>
      </div>

      <form onSubmit={add} className="card grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm text-muted">Goal</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Get Lenne to $50k/mo revenue" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm text-muted">Details (optional)</label>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Mostly via paid social; margins matter" />
        </div>
        <div>
          <label className="mb-1 block text-sm text-muted">Target date (optional)</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex items-end">
          <button className="btn btn-primary">Set goal</button>
        </div>
      </form>

      <div className="space-y-4">
        {goals.map((g) => {
          const sugg = suggestions.filter((s) => s.goal_id === g.id);
          return (
            <div key={g.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{g.title}</div>
                  {g.description && <div className="text-xs text-muted">{g.description}</div>}
                  {g.target_date && <div className="text-xs text-muted">by {g.target_date}</div>}
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-primary" onClick={() => suggest(g.id)} disabled={busyGoal === g.id}>
                    {busyGoal === g.id ? "Thinking…" : "Suggest moves"}
                  </button>
                  <button className="btn text-bad" onClick={() => removeGoal(g.id)}>
                    Delete
                  </button>
                </div>
              </div>

              {sugg.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-line pt-4">
                  {sugg.map((s) => (
                    <div key={s.id} className="rounded-xl border border-line bg-ink/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <span className={`pill mr-2 ${s.kind === "revenue" ? "text-good" : "text-accent2"}`}>
                            {s.kind}
                          </span>
                          <span className="font-medium">{s.title}</span>
                        </div>
                        {s.status === "proposed" ? (
                          <div className="flex gap-2">
                            <button
                              className="btn btn-primary"
                              disabled={busySuggestion === s.id}
                              onClick={() => decide(s.id, "approved")}
                            >
                              {busySuggestion === s.id ? "Jarvis is on it…" : "Approve & run"}
                            </button>
                            <button
                              className="btn text-bad"
                              disabled={busySuggestion === s.id}
                              onClick={() => decide(s.id, "rejected")}
                            >
                              Skip
                            </button>
                          </div>
                        ) : (
                          <span className="pill">{s.status}</span>
                        )}
                      </div>
                      {s.rationale && <p className="mt-1 text-sm text-muted">{s.rationale}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
