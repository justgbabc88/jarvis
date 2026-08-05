"use client";

import { useState } from "react";

type Field = { key: string; label: string; target?: number };

/** One-tap daily log form (linked from the tracker's Slack prompt). */
export default function TrackerForm({ trackerId, fields }: { trackerId: string; fields: Field[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [single, setSingle] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    const body =
      fields.length > 0
        ? {
            values: Object.fromEntries(
              fields.map((f) => [f.key, parseFloat(values[f.key] || "0") || 0])
            ),
          }
        : { value: parseFloat(single) || 0 };
    const res = await fetch(`/api/trackers/${trackerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) {
      setState("done");
      setMessage("Logged — thank you! ✅ Totals are on the dashboard.");
    } else {
      setState("error");
      const err = res ? await res.json().catch(() => ({})) : {};
      setMessage(`Couldn't save: ${err.error ? JSON.stringify(err.error) : "network error"}`);
    }
  }

  if (state === "done") {
    return <div className="card text-good">{message}</div>;
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      {fields.length > 0 ? (
        fields.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-sm text-muted">
              {f.label}
              {f.target ? <span className="text-xs"> · target {f.target}</span> : null}
            </label>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              value={values[f.key] || ""}
              placeholder="0"
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))
      ) : (
        <div>
          <label className="mb-1 block text-sm text-muted">Today's number</label>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            value={single}
            placeholder="0"
            onChange={(e) => setSingle(e.target.value)}
            autoFocus
          />
        </div>
      )}
      <button className="btn btn-primary w-full" disabled={state === "busy"}>
        {state === "busy" ? "Saving…" : "Log today's numbers"}
      </button>
      {state === "error" && <p className="text-sm text-bad">{message}</p>}
    </form>
  );
}
