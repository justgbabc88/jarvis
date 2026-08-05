"use client";

import { useEffect, useState } from "react";

type Tracker = {
  id: string;
  name: string;
  question: string | null;
  unit: string;
  fields: { key: string; label: string }[];
  slack: { channel?: string; prompt_time?: string; mention_name?: string };
  today: number | null;
  last7: number;
  total: number;
};

/**
 * Daily trackers — "cold outreach sent", "sales calls booked", …
 * Log today's number in one tap; Jarvis prompts for missing ones in
 * the daily Slack message and totals everything here.
 */
export default function TrackersCard() {
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/trackers");
    const data = await res.json();
    setTrackers(data.trackers || []);
    setLoaded(true);
  }
  useEffect(() => {
    load();
  }, []);

  async function log(t: Tracker) {
    const raw = values[t.id];
    const value = parseFloat(raw);
    if (!isFinite(value)) return;
    setBusy(true);
    await fetch(`/api/trackers/${t.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    setValues((v) => ({ ...v, [t.id]: "" }));
    await load();
    setBusy(false);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    await fetch("/api/trackers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setNewName("");
    await load();
    setBusy(false);
  }

  async function archive(t: Tracker) {
    if (!confirm(`Archive "${t.name}"? Its history is kept.`)) return;
    await fetch(`/api/trackers/${t.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="card">
      <div className="card-title mb-3">Daily trackers</div>

      {loaded && trackers.length === 0 && (
        <p className="text-sm text-muted">
          Track anything you do daily — cold outreach, sales calls, posts. Jarvis asks for the
          number in Slack each day and totals it here.
        </p>
      )}

      <ul className="space-y-3">
        {trackers.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.name}</div>
              <div className="text-xs text-muted">
                today: {t.today ?? "—"} · 7d: {t.last7} · total: {t.total}
                {t.slack?.prompt_time
                  ? ` · prompts ${t.slack.channel || "Slack"} at ${t.slack.prompt_time}${t.slack.mention_name ? ` (@${t.slack.mention_name})` : ""}`
                  : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {t.fields?.length > 0 ? (
                <a href={`/track/${t.id}`} className="btn">
                  Open form ({t.fields.length})
                </a>
              ) : (
                <>
                  <input
                    className="input w-24"
                    type="number"
                    inputMode="decimal"
                    placeholder={t.today == null ? "today?" : String(t.today)}
                    value={values[t.id] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [t.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), log(t))}
                  />
                  <button className="btn" disabled={busy} onClick={() => log(t)}>
                    Log
                  </button>
                </>
              )}
              <button
                className="btn text-muted"
                title="Archive tracker"
                onClick={() => archive(t)}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={create} className="mt-4 flex items-center gap-2">
        <input
          className="input flex-1"
          placeholder="New tracker, e.g. Cold outreach sent"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy || !newName.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
