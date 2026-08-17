"use client";

import { useEffect, useState } from "react";

type Lead = {
  id: string;
  business_name: string;
  trade: string | null;
  city: string | null;
  pain: string | null;
  channel: string | null;
  contact: string | null;
  opener: string | null;
  status: string;
  source: string | null;
  created_at: string;
};

const STATUSES = ["new", "contacted", "replied", "booked", "won", "dead"];
const FILTERS = ["all", ...STATUSES];

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(status = filter) {
    const res = await fetch(`/api/leads?status=${status}`);
    const data = await res.json();
    setLeads(data.leads || []);
    setCounts(data.counts || {});
    setLoaded(true);
  }
  useEffect(() => {
    load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function setStatus(id: string, status: string) {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    await fetch(`/api/leads/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load(filter);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Leads</h1>
          <p className="text-sm text-muted">
            What the prospecting agents found. {counts.total ?? 0} total ·{" "}
            {counts.new ?? 0} new · {counts.contacted ?? 0} contacted · {counts.booked ?? 0} booked
          </p>
        </div>
        <a className="btn" href={`/api/leads/export?status=${filter}`}>
          ⬇ Export CSV
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`btn ${filter === f ? "btn-primary" : ""}`}
          >
            {f}
            {f !== "all" && counts[f] ? ` (${counts[f]})` : ""}
          </button>
        ))}
      </div>

      {loaded && leads.length === 0 ? (
        <div className="card text-sm text-muted">
          No leads yet. The Overnight Prospect Hunter saves what it finds here each morning —
          or ask Chad in Slack to run it now.
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map((l) => (
            <div key={l.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {l.business_name}
                    {l.trade ? <span className="text-muted"> · {l.trade}</span> : null}
                    {l.city ? <span className="text-muted"> · {l.city}</span> : null}
                  </div>
                  {l.pain && <div className="mt-1 text-sm text-muted">{l.pain}</div>}
                  {l.contact && (
                    <div className="mt-1 font-mono text-xs text-accent2">
                      {l.channel ? `${l.channel}: ` : ""}
                      {l.contact}
                    </div>
                  )}
                </div>
                <select
                  className="input w-32"
                  value={l.status}
                  onChange={(e) => setStatus(l.id, e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {l.opener && (
                <div className="mt-2">
                  <button
                    className="text-xs text-accent2 hover:underline"
                    onClick={() => setOpen(open === l.id ? null : l.id)}
                  >
                    {open === l.id ? "hide opener" : "show opener"}
                  </button>
                  {open === l.id && (
                    <div className="mt-2 rounded-md border border-line/70 bg-panel2/50 p-3 text-sm">
                      {l.opener}
                      <button
                        className="btn mt-2 block"
                        onClick={() => navigator.clipboard?.writeText(l.opener || "")}
                      >
                        Copy
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
